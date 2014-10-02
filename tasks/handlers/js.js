/* jshint node: true */
/* global module, require */
'use strict';

var fs = require('fs');

var parser = require('acorn').parse;
var walker = require('acorn/util/walk').simple;
var builder = require('escodegen').generate;

var isStringLiteral = function (node) {
    return node.type === 'Literal' && (typeof node.value === 'string');
};

var isStrConcatExpr = function (node) {
    var left = node.left;
    var right = node.right;

    return node.type === 'BinaryExpression' && node.operator === '+' && (
        (isStringLiteral(left) || isStrConcatExpr(left)) &&
            (isStringLiteral(right) || isStrConcatExpr(right))
        );
};

// Assumes node is either a string Literal or a strConcatExpression
var extractStr = function (node) {
    if (isStringLiteral(node))
        return node.value;
    else
        return extractStr(node.left) + extractStr(node.right);
};

var isUrl = function (node) {
    // Turn off "arguments is a reserved word warnings:
    /* jshint -W024 */
    if (!node.arguments)
        return false;

    var callee = node.callee;
    var funcName = callee.name;
    var arg = node.arguments[0];
    var prop;

    if (!funcName) {
        if (callee.type !== 'MemberExpression')
            return false;

        // Special case for functionName.call calls
        if (callee.property.name === 'call') {
            prop = callee.object.property;
            funcName = callee.object.name || prop && (prop.name || prop.value);
            arg = node.arguments[1];  // skip context object
        } else {
            funcName = callee.property.name;
        }
    }

    if (funcName === 'geturl' && arg && (isStrConcatExpr(arg) || isStringLiteral(arg)))
        return arg;
};

var processNode = function (node) {
    var url = this.resolve(node.__url);

    // Replace "call expression" with a string literal (offline evaluation/macro)
    node.type = 'Literal';
    node.value = this.tree.get(url).name;

    if (this.tree.baseUrl)
        node.value = this.tree.baseUrl + '/' + node.value;
};

var extract = function () {
    var file = this;
    this.ast = parser(fs.readFileSync(this.name).toString());

    walker(this.ast, {'CallExpression': function (node) {
        var url = isUrl(node);

        if (!url)
            return;

        url = file.resolve(extractStr(url));

        if (!fs.existsSync(url)) {
            console.warn("Can't find " + url + " from " + this.name);
        }

        node.__url = url;
        file.dependOn(file.tree.get(url));
        file.marks.push(node);
    }});

    return this;
};

var substitute = function () {
    this.marks.forEach(processNode, this);

    fs.writeFileSync(this.name, builder(this.ast));

    return this;
};

module.exports = {
    '.js': {
        extract: extract,
        substitute: substitute
    }
};
