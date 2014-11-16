(function() {
    "use strict";

    var _;

    /*
        RequestParser Service
        A safe wrapper around the request to hide access to query, params and body.
        This allows us to sanitize those fields when requested.
    */

    var validator = require('validator'),
        sanitizer = require('sanitizer'),
        ForaRequest = require('fora-request');


    var isPrimitiveType = function(type) {
        return ['string', 'number', 'integer', 'boolean', 'array'].indexOf(type) > -1;
    };


    var isCustomType = function(type) {
        return !isPrimitiveType(type);
    };


    var RequestParser = function(request, typesService) {
        this.request = request;
        this.typesService = typesService;
    };


    RequestParser.prototype.body = function*(name, def) {
        def = def || { type: "string" };

        if (!this.request.requestBody) {
            _ = yield* this.request.initBody();
        }

        if (typeof(def) === "string")
            def = { type: def };

        var value = this.request.requestBody[name];

        if (value)
            return this.parseSimpleType(value, name, def);
    };


    RequestParser.prototype.files = function*() {
        if (!this.request.requestFiles)
            _ = yield* this.request.initFiles();
        return this.request.requestFiles;
    };


    RequestParser.prototype.map = function*(target, typeDefinition, whitelist, options, parents) {
        options = options || { overwrite: true };
        parents = parents || [];

        whitelist = whitelist.map(function(e) {
            return e.split('_');
        });

        return yield* this.map_impl(target, typeDefinition, whitelist, options, parents);

    };


    RequestParser.prototype.map_impl = function*(target, typeDefinition, whitelist, options, parents) {
        var changed = false;

        for (var fieldName in typeDefinition.schema.properties) {
            var def = typeDefinition.schema.properties[fieldName];
            var fieldWhiteList = whitelist.filter(function(e) { return e[0] === fieldName; });

            if (yield* this.setField(target, fieldName, def, typeDefinition, fieldWhiteList, options, parents))
                changed = true;
        }
        return changed;
    };


    RequestParser.prototype.setField = function*(obj, fieldName, def, typeDefinition, whitelist, options, parents) {
        if (isPrimitiveType(def.type)) {
            if (def.type !== 'array') {
                if (whitelist[0] && whitelist[0][0] === fieldName)
                    return yield* this.setSimpleType(obj, fieldName, def, typeDefinition, whitelist, options, parents);
            } else {
                return yield* this.setArray(obj, fieldName, def, typeDefinition, whitelist, options, parents);
            }
        } else {
            return yield* this.setCustomType(obj, fieldName, def, typeDefinition, whitelist, options, parents);
        }
    };


    //eg: name: "jeswin", age: 33
    RequestParser.prototype.setSimpleType = function*(obj, fieldName, def, typeDefinition, whitelist, options, parents) {
        var changed = false;
        var formField = parents.concat(fieldName).join('_');
        var val = yield* this.body(formField);
        if (val) {
            var result = this.parseSimpleType(val, fieldName, def, typeDefinition);
            if(!(obj instanceof Array)) {
                if (options.overwrite)
                    obj[fieldName] = result;
                else
                    obj[fieldName] = obj[fieldName] || result;
                changed = true;
            } else {
                obj.push(result);
                changed = true;
            }
        }
        return changed;
    };


    /*
        Two possibilities
        #1. Array of primitives (eg: customerids_1: 13, customerids_2: 44, or as CSV like customerids: "1,54,66,224")
        #2. Array of objects (eg: customers_1_name: "jeswin", customers_1_age: "33")
    */
    RequestParser.prototype.setArray = function*(obj, fieldName, def, typeDefinition, whitelist, options, parents) {
        var changed = false;
        if (typeDefinition && typeDefinition.mapping && typeDefinition.mapping[fieldName]) {
            if (def.items.type !== 'array') {
                if (whitelist.indexOf(fieldName) !== -1) {
                    var formField = parents.concat(fieldName).join('_');
                    var val = yield* this.body(formField);
                    var items = val.split(',');
                    items.forEach(function(i) {
                        obj[fieldName].push(this.parseSimpleType(val, fieldName + "[]", def.items, def));
                        changed = true;
                    });
                }
            }
            else
                throw new Error("Cannot map array of arrays");
        } else {
            parents.push(fieldName);

            var counter = 1;
            var newArray = obj[fieldName] || [];

            while(true) {
                if (yield* this.setField(newArray, counter, def.items, def, whitelist, options, parents)) {
                    counter++;
                    obj[fieldName] = obj[fieldName] || newArray;
                    changed = true;
                } else {
                    break;
                }
            }

            parents.pop();
        }

        return changed;
    };


    RequestParser.prototype.setCustomType = function*(obj, fieldName, def, typeDefinition, whitelist, options, parents) {
        var changed = false;

        whitelist = whitelist.map(function(a) { return a.slice(1); });
        parents.push(fieldName);
        if (def.typeDefinition && def.typeDefinition.ctor) {
            var newObj = def.typeDefinition.ctor ? def.typeDefinition.ctor() : {};
            changed = yield* this.map_impl(newObj, def.typeDefinition, whitelist, options, parents);
            if (changed) {
                if (!(obj instanceof Array))
                    obj[fieldName] = newObj;
                else
                    obj.push(newObj);
            }
        }
        parents.pop();

        return changed;
    };


    RequestParser.prototype.parseSimpleType = function(val, fieldName, def, typeDefinition) {
        if (val) {
            switch(def.type) {
                case "integer":
                    return parseInt(val);
                case "number":
                    return parseFloat(val);
                case "string":
                    return (typeDefinition && typeDefinition.htmlFields && typeDefinition.htmlFields.indexOf(fieldName) !== -1) ?
                        sanitizer.sanitize(sanitizer.unescapeEntities(val)) : sanitizer.escape(val);
                case "boolean":
                    return val === "true";
                default:
                    throw new Error(def.type + " " + fieldName + " is not a primitive type or is an array. Cannot parse.");
            }
        }
    };

    module.exports = RequestParser;

})();
