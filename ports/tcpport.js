'use strict';
var util = require('util');
var events = require('events');
var EventEmitter = events.EventEmitter || events;
var net = require('net');
const exec = require('child_process').exec;
var crc16 = require('./../utils/crc16');

var MODBUS_PORT = 502; // modbus port
var MAX_TRANSACTIONS = 64; // maximum transaction to wait for
var defaultTimeout = 1000;
var connectTimeout = 7000;
/**
 * Simulate a modbus-RTU port using modbus-TCP connection
 */
var TcpPort = function(ip, options) {
    var modbus = this;
    this.ip = ip;
    this.openFlag = false;
    this.callback = null;
    this.connected = false;
    this.connecting = false;
    this.timeout = options.timeout || defaultTimeout;

    // options
    if (typeof(options) == 'undefined') options = {};
    this.port = options.port || MODBUS_PORT; // modbus port

    // handle callback - call a callback function only once, for the first event
    // it will triger
    var handleCallback = function(had_error) {
        if (modbus.callback) {
            modbus.callback(had_error);
            modbus.callback = null;
        }
    }

    // create a socket
    this._client = new net.Socket();
    this._client.on('data', function(data) {
        var buffer;
        var crc;

        // check data length
        if (data.length < 6) return;

        // cut 6 bytes of mbap, copy pdu and add crc
        buffer = new Buffer(data.length - 6 + 2);
        data.copy(buffer, 0, 6);
        crc = crc16(buffer.slice(0, -2));
        buffer.writeUInt16LE(crc, buffer.length - 2);

        // update transaction id
        modbus._transactionId = data.readUInt16BE(0)

        // emit a data signal
        modbus.emit('data', buffer);
    });

    this._client.on('connect', function() {
        modbus.connected = true;
        modbus.connecting = false;
        console.error('Modbus TCP connect');
        handleCallback();
    });

    this._client.on('close', function(had_error) {
        modbus.connected = false;
        modbus.connecting = false;
        // modbus._client.destroy();
        console.error('Modbus TCP close');
        handleCallback(had_error);

    });

    this._client.on('error', function(had_error) {
        // modbus.openFlag = false;
        modbus.connected = false;
        modbus.connecting = false;
        // modbus._client.destroy();
        console.error('Modbus TCP error');
        handleCallback(had_error);
        modbus._client.end();

    });


    this.connect();
    this.setupReconnector();

    EventEmitter.call(this);
};
util.inherits(TcpPort, EventEmitter);

/**
 * Simulate successful port open
 */
TcpPort.prototype.open = function (callback) {
    this.callback = callback;
    this.openFlag = true;
};

/**
 * Simulate successful close port
 */
TcpPort.prototype.close = function (callback) {
    this.callback = callback;
    console.error('modebus tcp openFlag',this.openFlag);
    this.openFlag = false;
    this._client.end();
};

/**
 * Check if port is open
 */
TcpPort.prototype.isOpen = function() {
    return this.connected;
};

/**
 * Send data to a modbus-tcp slave
 */
TcpPort.prototype.write = function (data) {
    // get next transaction id
    var transactionsId = (this._transactionId + 1) % MAX_TRANSACTIONS;

    // remove crc and add mbap
    var buffer = new Buffer(data.length + 6 - 2);
    buffer.writeUInt16BE(transactionsId, 0);
    buffer.writeUInt16BE(0, 2);
    buffer.writeUInt16BE(data.length - 2, 4);
    data.copy(buffer, 6);

    // send buffer to slave
    this._client.write(buffer);
};

TcpPort.prototype.connect = function(){

    console.log('Modebus TCP connect to server...'+this.ip +":"+this.port);
    this.connecting = true;
    this._client.connect(this.port, this.ip);
    this._client.setKeepAlive(false);
    this._client.setTimeout(1000);
    setTimeout(function () {
        this.connecting = false;
    }.bind(this),connectTimeout);

}

TcpPort.prototype.setupReconnector = function () {

    setInterval(function(){
        // console.log("openFlag:",this.openFlag,"connected:",this.connected,"connecting:",this.connecting);
       // if(this.openFlag){
            if(!this.connected && !this.connecting){
                console.log('Modebus TCP reconnect to server...'+this.ip +":"+this.port);
                 if(this._client){
                      this._client.removeAllListeners();
                      this._client.end();
                      this._client.destroy();
                      delete this._client;
                      this._client = null;
                      this.ReleasePort(this.port);
                 }
                //
                // process.exit(0);
                 this._client = new net.Socket();

                this.connect();
            }
        //}

    }.bind(this),3000);
};

TcpPort.prototype.ReleasePort = function (port) {
    var cmd='netstat -anp | grep '+port;//process.platform=='win32'?'netstat -ano':'ps aux';

    var port=port;

    exec(cmd, function(err, stdout, stderr) {
        if(err){ return console.log(err.message); }

        stdout.split('\n').filter(function(line){
            var p=line.trim().split(/\s+/);
            var address=p[3];
            var pid = undefined;

            if(p[6] && p[6].split('/')[0]){
                pid = p[6].split('/')[0];
            }

            console.error(JSON.stringify(p));

            if(address!=undefined && pid != undefined){
                var addressArr = address.split(':');
                if(addressArr[1] && addressArr[1].length && addressArr[1].length>1 && addressArr[1]==port && (p[6].split('/')[0] != process.pid))
                {
                    exec('kill -9 '+pid,function(err, stdout, stderr){
                        if(err){
                            return console.error('not killed',port);
                        }

                        console.error('killed ',port);
                    });
                }
            }
        });
    });
};

module.exports = TcpPort;
