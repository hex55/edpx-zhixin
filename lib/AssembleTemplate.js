/***************************************************************************
*
* Copyright (C) 2014 Baidu.com, Inc. All Rights Reserved
*
***************************************************************************/

/**
 * @file AssembleTemplate.js ~ 2014-04-09 14:34
 * @author sekiyika (px.pengxing@gmail.com)
 * @description
 *  1. 根据VUI的渲染结果，拼装模板
 *  2. 拆解模板，将占位符塞进去
 */
var util = require('./util');

/**
 * @type {string}
 * 左侧渲染结果的占位符
 */
var LEFT_CONTENT = '{%LEFT_CONTENT%}';
/**
 * @type {string}
 * 右侧渲染结果的占位符
 */
var RIGHT_CONTENT = '{%RIGHT_CONTENT%}';


/**
 * @param {string} template
 * @param {Obejct} result
 *
 * result的格式为
 * {
 *     'left': {
 *         'ecl_ec_weigou': '<div>...</div>',
 *         'ecl_game': '<div>...</div>'
 *     },
 *     'right': {
 *         'ecl_ec_weigou': '<div>...</div>',
 *         'ecl_game': '<div>...</div>'
 *     }
 * }
 *
 * @return {string} 返回拼装之后的html字符串
 */
exports.assmeble = function(template, result) {
    result = result || {};

    var lhtml = '';
    var rhtml = '';

    var keys = [];

    for(var key in result.left) {
        keys.push(key);
        lhtml += result.left[key];
    }
    for(key in result.right) {
        keys.push(key);
        rhtml += result.right[key];
    }

    if(false !== result.removeSameTpl && keys.length > 0) {
        //移除同名标签块
        keys.forEach(function(key) {
            template = util.removeTplBlock(template, key);
        });
    }
    
    

    template = template.replace(LEFT_CONTENT, lhtml);
    template = template.replace(RIGHT_CONTENT, rhtml);

    return template;
};

/**
 * 拆解模板，替换占位符
 * @param {string} platform pc or pad
 * @param {string} html
 *
 * @return {string} 返回拆解后的模板字符串
 */
exports.disassemble = function(platform, html) {

    // TODO (by who) 考虑搜索没有结果的情况

    if(platform === 'ipad') {
        html = html.replace(/(<ul\s*class=\"bds-result-lists\"[^>]*>)/, '$1' + LEFT_CONTENT);
        html = html.replace(/(<div\s*id=\"con-ar\"[^>]*>)/, '$1' + RIGHT_CONTENT);
    } else {
        html = html.replace(/(<div\s*id=\"content_left\"[^>]*>)/, '$1' + LEFT_CONTENT);
        html = html.replace(/(<div\s*id=\"content_right\"[^>]*>)/, '$1' + RIGHT_CONTENT);
    }

    return html;
};


