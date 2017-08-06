// 
//node craw.js url base64ua port

const CDP = require('chrome-remote-interface');
const base64 = require('base-64');
const args = process.argv;

var url='https://itbdw.com';

//for debug Network.getResponseBody truncated
url = 'https://cdn.bootcss.com/jquery/3.2.1/jquery.min.js';

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

CDP({port:port}, (client) => {
    // extract domains
    const {Network, Page, Runtime, DOM} = client;

    Network.setUserAgentOverride({userAgent:userAgent});
    Network.setBlockedURLs({urls: blocked_pattens});

    // setup handlers
    Network.requestWillBeSent((params) => {

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

    Network.responseReceived((params) => {

        if (params.response.url == url || params.response.url == url + '/' ) {
            head = {
                "url":params.response.url,
                "status":params.response.status,
                "content-type":params.response.mimeType,
                "location":""
            };
       }

    });

    Page.loadEventFired(() => {
        if (!head['status']) {
            console.error('no status code return! ' + url);
            client.close();
            process.exit(1);
        }

        console.log(head['status']);
        console.log(head['content-type']);
        console.log(head['location']);

        if (head['content-type'].indexOf('html') > -1) {
              Runtime.evaluate({expression: 'document.documentElement.outerHTML'}).then((result) => {
                  console.log(result.result.value);
                  client.close();
                  process.exit(0);
             });
        } else {
            // safe enough to fetch response body
            Network.getResponseBody({requestId: requestId}, (err, response) => {
                if (err) {
                    console.error('failed fetch response body');
                    client.close();
                    process.exit(1);
                } else {
                    //bug, data truncated
                    // have no idea where the truncation was made
                    // https://github.com/cyrus-and/chrome-remote-interface
                    // https://github.com/ChromeDevTools/devtools-protocol

                    if (response.base64Encoded) {
                        console.log(base64.decode(response.body));
                    } else {
                        console.log(response.body);
                    }

                    client.close();
                    process.exit(0);
                }
            })
        }
    });

    // enable events then start!
    Promise.all([
        Network.enable(),
        Page.enable()

    ]).then(() => {
        return Page.navigate({url: url});
    }).catch((err) => {
        console.error(err);
        client.close();
        process.exit(1);
    });

}).on('error', (err) => {
    // cannot connect to the remote endpoint
    console.error(err);
    process.exit(2);
});




