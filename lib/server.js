/***************************************************************************
*
* Copyright (C) 2014 Baidu.com, Inc. All Rights Reserved
*
***************************************************************************/

/**
 * @file server.js ~ 2014-04-26 14:35
 * @author sekiyika (px.pengxing@gmail.com)
 * @description
 *  启动webserver
 */


var ws = require('edp-webserver');
var urlLib = require('url');
var path2RegExp = require('path-to-regexp');
var path = require('path');
var fs = require('fs');
var edp = require('edp-core');

var Render = require('./render');
var RenderWise = require('./render-wise');
var util = require('./util');
var AssembleTemplate = require('./AssembleTemplate'); 
var AssembleTemplateWise = require('./AssembleTemplate-wise'); 
var indexer = require('./indexer');
var cache = require('./cache');


/**
 * 判断请求是否需要代理，如果需要代理，返回代理的文件内容
 * @param {http.ClientRequest} request
 */
function shouldProxy(request, gConf) {
    var referer = request.headers.referer;

    var tpls;

    if(referer) {
        var refs = urlLib.parse(referer, true);
        var query = refs.query.wd;
        var platform = refs.query.dsp || 'pc';

        if(!query) {
            // 如果referer没有query，采用全局的
            tpls = indexer.name2ConfMap;
        } else {
            var renderConf = indexer.getRenderConf(query, platform, gConf);
            if(!renderConf) {
                return;
            }
            tpls = util.extend({}, renderConf.left, renderConf.right);
        }

    } else {
        // 如果没有referer，则运行所有的规则
        tpls = indexer.name2ConfMap;
    }

    var url = request.pathname;

    var config;
    var as;
    var item;
    var location;
    var i;
    for(var name in tpls) {
        config = indexer.name2ConfMap[name];

        as = config.ajaxs;
        if(as && as.length > 0) {
            for(i = 0, l = as.length; i < l; i++) {
                item = as[i];
                location = item.url;

                if ( false
                       || (location instanceof RegExp && location.test(url))
                       || (typeof location === 'string' && path2RegExp( location, null, { sensitive: true } ).exec(url))
                       || (typeof location === 'function' && location( request ) )
                   ) {
                       // 匹配成功
                       if(!item.handler && item.file) {
                           request._proxyHandler = (function(file, dir) {
                               return function() {
                                   if(!fs.existsSync(file)) {
                                       file = path.resolve(dir + path.sep + file);
                                   }
                                   edp.log.info(''
                                        + edp.chalk.yellow('PROXY')
                                        + ' '
                                        + edp.chalk.green(url)
                                        + ' to '
                                        + edp.chalk.green(file)
                                   );
                                   return fs.readFileSync(file);
                               };
                           })(item.file, config.fullpath);
                       } else {
                           edp.log.info(edp.chalk.yellow('PROXY ') + edp.chalk.green(url));

                           request._proxyHandler = item.handler;
                       }
                       return true;
                   }
            }
        }
    }

}

/**
 * 处理proxy的返回
 * @param {Object} context
 */
function handleProxy(context, g) {
    var request = context.request;

    var handler = request._proxyHandler;
    if(typeof handler === 'string') {
        context.content = handler;
    } else if(typeof handler === 'function') {
        context.content = handler(context);
    }

}

/**
 * 渲染
 * @param {Object} context
 * @param {string} root
 * @param {Object} gConf
 * @param {Object} isWise 是否wise渲染
 */
function render(context, root, gConf, isWise) {
    context.stop();

    var queryObj = context.request.query;

    if(isWise) {
        // 从indexer获取本次应该渲染的卡片配置
        var renderConf = indexer.getRenderConf(queryObj.word, queryObj.tn || 'iphone', gConf);
        // 在这里进行渲染，拿到渲染后的结果
        var promise = RenderWise.render(
            gConf.php ? gConf.php : 'php',
            renderConf
        );
    }
    else {
        // 从indexer获取本次应该渲染的卡片配置
        var renderConf = indexer.getRenderConf(queryObj.wd, queryObj.dsp, gConf);
        // 在这里进行渲染，拿到渲染后的结果
        var promise = Render.render(
            gConf.php ? gConf.php : 'php',
            renderConf
        );
    }

    promise.done(function(output) {
        var data;
        if(!output) {
            data = {};
        } else {

            try{ 
                // 防止有notice和warming导致json串不能解析
                output = output.output.replace(/[^{}]*(.*)[^{}]*/g, 
                    function () {
                        return arguments[1];
                    }
                );
                data = JSON.parse(output);
            } catch(e) {
                console.log(e);
            }
        }

        context._renderResult = data;

        context.start();
    });
    promise.fail(function(output) {
        context._renderResult = '<pre>' + output.output + '</pre>';
        context.start();
    });

}


exports.start = function(root, gConf) {

    /**
     * edp webserver的配置文件
     * 
     * @type {Object}
     */
    var edpWSConfig = {
        
        /**
         * 配置ws的documentRoot
         */
        documentRoot: root,
        port: gConf.server.port,
        overrideProxyRequestHeader: function(headers) {
            headers.Host = gConf.proxy.hostname;
        },

        getLocations: function() {
            var locations = [
                {
                    location: function(request) {
                        return shouldProxy(request, gConf);
                    },
                    handler: function(context) {
                        handleProxy(context);
                    }
                },
                {
                    location: /^\/$/,
                    handler: proxy(gConf.proxy.hostname, gConf.proxy.port)
                },

                //wise相关配置
                {
                    location: /\/s\?word=.*/,
                    handler: [
                        function(context) {
                            var count = 0;
                            var start = context.start;
                            var stop = context.stop;
                            context.start = function() {
                                count--;
                                if(count === 0) {
                                    context.start = start;
                                    context.stop = stop;
                                    start();
                                }
                            };
                            context.stop = function() {
                                count++;
                                stop();
                            };

                            var queryObj = context.request.query;
                            
                            //TODO wise的中文编码规则不固定，这里需要解码
                            queryObj.word = util.decodeWiseWord(queryObj.word, String(queryObj.ix).replace('%', ''));

                            // proxy将代理返回的内容存放在context.content中
                            cache.proxyContent(context, gConf);

                            // 渲染
                            render(context, root, gConf, true);
                        },
                        function(context) {
                            //缓存我们在上面的handler中用proxy来产生的内容
                            cache.updateCachedContent(context);
                            // 这里进行解码操作，删除header中的content-encoding
                            delete context.header['content-encoding'];

                            if(typeof context._renderResult === 'string') {
                                context.content = context._renderResult;
                                context.status = 500;
                                return;
                            }

                            context.stop();
                            var zlib = require('zlib');

                            // 当前都是gzip，所以目前只考虑gzip的格式
                            zlib.gunzip(context.content, function(err, buffer) {
                                if(!err) {
                                    var content = buffer.toString();

                                    var queryObj = context.request.query;

                                    content = AssembleTemplateWise.disassemble(queryObj.tn, content);

                                    // 在这里进行拼装，将模板和渲染的数据进行拼装
                                    if(context._renderResult) {
                                        context._renderResult.removeSameTpl = gConf.removeSameTpl;
                                    }

                                    content = AssembleTemplateWise.assmeble(content, context._renderResult);

                                    context.content = content;
                                    context.start();
                                } else { 
                                    context.status = 500;
                                    context.start();
                                }

                            });
                        }
                    ]
                },
                {
                    location: /^\/s\?.*/,
                    handler: [
                        function(context) {
                            var count = 0;
                            var start = context.start;
                            var stop = context.stop;
                            context.start = function() {
                                count--;
                                if(count === 0) {
                                    context.start = start;
                                    context.stop = stop;
                                    start();
                                }
                            };
                            context.stop = function() {
                                count++;
                                stop();
                            };

                            // proxy将代理返回的内容存放在context.content中
                            cache.proxyContent(context, gConf);

                            // 渲染
                            render(context, root, gConf);
                        },
                        function(context) {
                            //缓存我们在上面的handler中用proxy来产生的内容
                            cache.updateCachedContent(context);
                            // 这里进行解码操作，删除header中的content-encoding
                            delete context.header['content-encoding'];

                            if(typeof context._renderResult === 'string') {
                                context.content = context._renderResult;
                                context.status = 500;
                                return;
                            }

                            context.stop();
                            var zlib = require('zlib');

                            // 当前都是gzip，所以目前只考虑gzip的格式
                            zlib.gunzip(context.content, function(err, buffer) {
                                if(!err) {
                                    var content = buffer.toString();

                                    var queryObj = context.request.query;

                                    // 通过webserver来代理这些静态文件
                                    // var requestHeaders = context.request.headers;
                                    // var proxyedUrl = ['http://',requestHeaders.host,'/proxy_url'].join('');
                                    // content = proxyLinks.proxyLinks(content, proxyedUrl);
                                    content = AssembleTemplate.disassemble(queryObj.dsp, content);

                                    // 在这里进行拼装，将模板和渲染的数据进行拼装
                                    if(context._renderResult) {
                                        context._renderResult.removeSameTpl = gConf.removeSameTpl;
                                    }
                                    
                                    content = AssembleTemplate.assmeble(content, context._renderResult);

                                    context.content = content;
                                    context.start();
                                } else { 
                                    // 发生服务器错误
                                    context.status = 500;
                                    // 这一步发生错误，也得到最后啊
                                    context.start();
                                }

                            });
                        }
                    ]
                },
                {
                    location: /^\/proxy_url.*/,
                    handler: [
                        function(context) {
                            var query = context.request.query;
                            if(query.url) {
                                
                                var urlLib = require('url');
                                var url = urlLib.parse(query.url);
                                // 重写request的url
                                context.request.url = url.path;
                                context.request.headers.host = url.hostname;
                                //增加referer，以通过百度对图片的验证
                                context.request.headers.referer = 'http://' + gConf.proxy.hostname;
                                // 代理一下
                                (proxy(url.hostname, url.port ? url.port : 80))(context);
                            }
                        }
                    ]
                }
            ];

            if(gConf.server.getLocations && typeof gConf.server.getLocations === 'function') {
                var locs = gConf.server.getLocations();
                if(locs && locs instanceof Array) {
                    locations = locations.concat(locs);
                }
            }
            locations.push({
                location: /^.*$/,
                handler: proxy(gConf.proxy.hostname, gConf.proxy.port)
            });
            return locations;
        },

        injectResource: function ( res ) { 
            for ( var key in res ) { 
                global[ key ] = res[ key ];
            }   
        }
    };
        

    ws.start(edpWSConfig);
};
