// 
//node craw.js url base64ua port

// 使用 process.exit 会导致直接中断，不会输出 buffer
//https://nodejs.org/api/process.html#process_process_exit_code

const CDP = require('chrome-remote-interface');
const base64 = require('base-64');
const args = process.argv;

var url='https://itbdw.com';

var ua = '';
var port = 9222;
var blocked_pattens = ["*.mp4", "*.webm"];
var requestId = '';

url = args[2] ? args[2] : url;

if (args[3]) {
    ua = base64.decode(args[3]);
}

if (args[4]) {
    port = args[4];
}

userAgent = ua + ' ' + 'ServerRenderJavascript';

var head = {};

CDP({port:port}, function(client) {
    // extract domains
    const {Network, Page, Runtime, DOM} = client;

    Network.setUserAgentOverride({userAgent:userAgent});
    Network.setBlockedURLs({urls: blocked_pattens});

    // setup handlers
    Network.requestWillBeSent(function(params) {
        if (params.documentURL == url || params.documentURL == (url + '/')) {

            requestId = params.requestId;

            if (params.redirectResponse) {

                headers = params.redirectResponse.headers;

                for (x in headers) {
                    headers[x.toLowerCase()] = headers[x];
                }

                head = {
                    "url": params.documentURL,
                    "status":params.redirectResponse.status,
                    "content-type":params.redirectResponse.mimeType,
                    "location":headers['location']
                };

                //if redirect, not more data
                // Network.disable();
            }
        }
    });

    Network.responseReceived(function(params) {

        if (params.response.url == url || params.response.url == url + '/' ) {
            head = {
                "url":params.response.url,
                "status":params.response.status,
                "content-type":params.response.mimeType,
                "location":""
            };

            if (head['content-type'] == 'application/octet-stream') {
                process.exitCode = 1;
                console.log("Not Support For Downloadable Files: " + url);
                client.close();
            }
        }

    });

    Page.loadEventFired(function() {
        if (!head['status']) {
            console.error('no status code return! ' + url);
            client.close();
            process.exitCode = 1;
        }

        console.log(head['status']);
        console.log(head['content-type']);
        console.log(head['location']);

        if (head['content-type'].indexOf('html') > -1) {
              Runtime.evaluate({expression: 'document.documentElement.outerHTML'}).then(function(result) {
                  console.log(result.result.value);
                  client.close();
             });
        } else {
            // safe enough to fetch response body
            Network.getResponseBody({requestId: requestId}, function(err, response) {
                if (err) {
                    console.error('failed fetch response body');
                    client.close();
                    process.exitCode = 1;
                } else {
                    if (response.base64Encoded) {
                        console.log(base64.decode(response.body));
                    } else {
                        console.log(response.body);
                    }

                    client.close();
                }
            })
        }
    });

    Network.responseReceived(function(params) {
        // console.log(params);
    });
    Network.loadingFinished(function(params) {
        // console.log(params);
    });

    // enable events then start!
    Promise.all([
        Network.enable(),
        Page.enable()

    ]).then(function() {
        return Page.navigate({url: url});
    }).catch(function(err) {
        console.error(err);
        client.close();
        process.exitCode = 1;
    });

}).on('error', function(err) {
    // cannot connect to the remote endpoint
    console.error(err);
    process.exitCode = 2;
});




