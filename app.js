#!/usr/bin/env node

var os = require('os'),
    http = require("http"),
    PubSub = require("pubsub-js"),
    program = require('commander'),
    pjson = require('./package.json');

program
    .version(pjson.version)
    .description(pjson.description)
    .option('-p --port <n>', 'port number (default 8080)', parseInt)
    .option('-v --version', 'show version')
    .parse(process.argv);

program.on('--help', function(){
    console.log("Usage: " + pjson.name + " [OPTION]\n");
});

var port = program.port || 8080,
    boundaryID = "BOUNDARY";

/**
 * create a server to serve out the motion jpeg images
 */
var server = http.createServer(function(req, res) {

    // return a html page if the user accesses the server directly
    if (req.url === "/") {
        res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
        res.write('<!doctype html>');
        res.write('<html>');
        res.write('<head><title>' + pjson.name + '</title><meta charset="utf-8" /></head>');
        res.write('<body>');
        res.write('<img src="image.jpg" />');
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
    if (req.url.match(/^\/.+\.jpg$/)) {

        res.writeHead(200, {
            'Content-Type': 'multipart/x-mixed-replace;boundary="' + boundaryID + '"',
            'Connection': 'keep-alive',
            'Expires': 'Fri, 27 May 1977 00:00:00 GMT',
            'Cache-Control': 'no-cache, no-store, max-age=0, must-revalidate',
            'Pragma': 'no-cache'
        });

        //
        // send new frame to client
        //
        var subscriber_token = PubSub.subscribe('MJPEG', function(msg, data) {

            //console.log('sending image');

            res.write('--' + boundaryID + '\r\n')
            res.write('Content-Type: image/jpeg\r\n');
            res.write('Content-Length: ' + data.length + '\r\n');
            res.write("\r\n");
            res.write(Buffer(data), 'binary');
            res.write("\r\n");
        });

        //
        // connection is closed when the browser terminates the request
        //
        res.on('close', function() {
            console.log("Connection closed!");
            PubSub.unsubscribe(subscriber_token);
            res.end();
        });
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
console.log('');


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
