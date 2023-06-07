#!/usr/bin/env node

import os from 'os';
import http from 'http';
import PubSub from 'pubsub-js';

import { Command } from 'commander';
const program = new Command();

import redis from 'redis';
import pjson from './package.json' assert { type: 'json' }

program
    .version(pjson.version)
    .description(pjson.description)
    .option('-r --redis <URL>', 'Redis URL (default redis://localhost)')
    .option('-p --port <n>', 'port number (default 8080)', parseInt)
    .option('-v --version', 'show version')
    .parse(process.argv);

const opts = program.opts();

var port = opts.port || 8080,
    boundaryID = "COXLABBOUNDARY";

const redisUrl = opts.redis || 'redis://localhost';

console.log(`Connecting Redis (${redisUrl})`);

var redisClient = redis.createClient({
    url: redisUrl
});

try {
    await redisClient.connect();
    console.log('Redis connected');
} catch(error) {
    console.error('Redis connect fail');
    console.error(error);
    process.exit(1);
}

const subscriber = redisClient.duplicate();
subscriber.on('error', (err) => {
    console.error(err);
});
try {
    await subscriber.connect();
} catch(e) {
    console.error(e);
    sys.exit(1);
}

var resp_subs_map = {};

/**
 * create a server to serve out the motion jpeg images
 */
var server = http.createServer(async (req, res) => {
    console.log(`Req URL: ${req.url}`);
    // return a html page if the user accesses the server directly
    if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
        res.write('<!doctype html>');
        res.write('<html>');
        res.write('<head><title>' + pjson.name + '</title><meta charset="utf-8" /></head>');
        res.write('<body>');
        res.write('<video src="/LWAC1F09FFFE09112A/image" />');
        // res.write('<img src="/LWAC1F09FFFE09112A/image" />');
        res.write('</body>');
        res.write('</html>');
        res.end();
        return;
    }

    if (req.url === "/healthcheck") {
        res.statusCode = 200;
        res.end();
        return;
    };

    // for image requests, return a HTTP multipart document (stream)
    let uri = req.url.split('/').slice(1);

    if (uri.length == 2) {
        const statusKey = `ImageToRtsp:${uri[0]}:${uri[1]}:status`;
        const bufferKey = `ImageToRtsp:${uri[0]}:${uri[1]}:buffer`;
        
        console.log(`Subscribing ${statusKey}c`);
        await subscriber.subscribe(statusKey + 'c', async (message, channel) => {
            let status;

            try {
                status = JSON.parse(message);
            } catch(e) {
                console.error(`Cannot parse status: ${e}`);
                return;
            }

            if (typeof status === 'object' && status.hasOwnProperty('size') && status.hasOwnProperty('offset')) {
                if (status.offset == 0) {
                    console.log('Starting streaming...');
                    // res.write('--' + boundaryID + '\r\n');
                    res.write('Content-Type: image/jpeg\r\n');
                    res.write('Content-Length: ' + status.size + '\r\n');
                    res.write("\r\n");
                }

                let bufferLength = await redisClient.STRLEN(bufferKey);
                if (bufferLength == status.size) {
                    res.write("\r\n");
                    res.write('--' + boundaryID + '\r\n');
                    console.log('End of streaming'); 
                    // res.end();
               } else {
                    console.log(`Streaming... [ ${bufferLength} / ${status.size} ] (${bufferLength / status.size * 100})`);
                }

            } else {
                console.error(`Invalid status: ${e}`);
            }
        }, true /* buffer mode */);
        
        if (resp_subs_map.hasOwnProperty(statusKey)) {
            if (!resp_subs_map[statusKey].includes(res)) {
                resp_subs_map[statusKey].push(res);
            }
        } else {
            resp_subs_map[statusKey] = [ res ];
        }

        console.log(`Subscribing ${bufferKey}c`);
        await subscriber.subscribe(bufferKey + 'c', (data, channel) => {
            res.write(data, 'binary');
            
            console.log(`Write published data (${data.length} byte) to res ${res.writableEnded}`);
        }, true /* buffer mode */);

        if (resp_subs_map.hasOwnProperty(bufferKey)) {
            if (!resp_subs_map[bufferKey].includes(res)) {
                resp_subs_map[bufferKey].push(res);
            }
        } else {
            resp_subs_map[bufferKey] = [ res ];
        }

        let status;
        try {
            status = JSON.parse(await redisClient.GET(statusKey));
        } catch(e) {
            console.error(`Cannot parse status: ${e}`);
        }
        if (typeof status === 'object' && status.hasOwnProperty('size')) {
            res.writeHead(200, {
                'Content-Type': 'multipart/x-mixed-replace;boundary="' + boundaryID + '"',
                'Connection': 'keep-alive',
                'Expires': 'Fri, 27 May 1977 00:00:00 GMT',
                'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
                'Pragma': 'no-cache'
            });
            console.log('writing header');
            
            res.write('--' + boundaryID + '\r\n')
            // res.setHeader('Content-Type', 'image/jpeg');
            // res.setHeader('Content-Length', status.size);
            res.write('Content-Type: image/jpeg\r\n');
            res.write('Content-Length: ' + status.size + '\r\n');
            res.write("\r\n");
            console.log('writing boundary');

            let data = await redisClient.GET(redis.commandOptions({
                returnBuffers: true
            }), bufferKey);
            res.write(data, 'binary');
            console.log(`Load and write data ${data.length}`);

            let bufferLength = await redisClient.STRLEN(bufferKey);
            if (bufferLength == status.size) {
                res.write("\r\n");
                res.write('--' + boundaryID + '\r\n')
                console.log('End of streaming');
                // res.end();
            }
        } else {
            console.error(`Invalid status: ${status}`);
        }
        
        res.on('close', function() {
            if (resp_subs_map.hasOwnProperty(statusKey) && resp_subs_map[statusKey].includes(res)) {
                resp_subs_map[statusKey].splice(resp_subs_map[statusKey].indexOf(res), 1);

                if (resp_subs_map[statusKey].length == 0) {
                    delete resp_subs_map.statusKey;
                    subscriber.unsubscribe(statusKey);
                }
            }

            if (resp_subs_map.hasOwnProperty(bufferKey) && resp_subs_map[bufferKey].includes(res)) {
                resp_subs_map[bufferKey].splice(resp_subs_map[bufferKey].indexOf(res), 1);

                if (resp_subs_map[bufferKey].length == 0) {
                    delete resp_subs_map.bufferKey;
                    subscriber.unsubscribe(bufferKey);
                }
            }

            console.log(`Connection closed! (# of subs ${statusKey}:${resp_subs_map[statusKey].length}, ${bufferKey}:${resp_subs_map[bufferKey].length}`);


            res.end();
        });
    } else {
        res.statusCode = 404;
        res.end();
        return;
    }
});

server.on('error', function(e) {
    if (e.code == 'EADDRINUSE') {
        console.log('port already in use');
    } else if (e.code == "EACCES") {
        console.log("Illegal port");
    } else {
        console.log("Unknown error");
    }
    process.exit(1);
});

// start the server
server.listen(port);
console.log(pjson.name + " started on port " + port);

// hook file change events and send the modified image to the browser
// watcher.on('change', function(file) {

//     //console.log('change >>> ', file);

//     fs.readFile(file, function(err, imageData) {
//         if (!err) {
//             PubSub.publish('MJPEG', imageData);
//         }
//         else {
//             console.log(err);
//         }
//     });
// });
