/**
 * Created by YX on 2016/9/10.
 */
'use strict';
var util = require('util');
var events = require('events');
var EventEmitter = events.EventEmitter || events;
var _ = require('underscore');
var net = require('net');
var MODBUS_PORT = 4001; // modbus port
var MAX_TRANSACTIONS = 64; // maximum transaction to wait for
var ModbusRTU = require('modbus-serial');

/**
 * Simulate a modbus-RTU port using modbus-TCP connection
 */
var ComOverTcpPort = function(ip_port, options) {
    EventEmitter.call(this);
    var modbus = this;
    var portSplit = ip_port.split(':');
    this.ip = portSplit[0];
    this.port = parseInt(portSplit[1]);
    this.openFlag = false;
    this.connected = false;
    this.callback = null;
    this.connecting = false;
    this._client = new net.Socket();
    this.writeStarted = false;
    // options
    if (typeof(options) == 'undefined') options = {};
    

    // handle callback - call a callback function only once, for the first event
    // it will triger
    var handleCallback = function(had_error) {
        if (modbus.callback) {
            modbus.callback(had_error);
            modbus.callback = null;
        }
    }

    // create a socket

    this._client.on('data', function(data) {
        modbus.connecting = false;
        if( this.writeStarted){
            var buffer = new Buffer(data.length);
            /*
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
             */
            data.copy(buffer,0,0, data.length);
            // emit a data signal
            modbus.emit('data', buffer);
        }else{
            console.error('ComOverTcpPort recv data before write!!',data);
        }

    }.bind(this));

    this._client.on('connect', function() {
        modbus.connected = true;
        modbus.connecting = false;
        handleCallback();

    });

    this._client.on('close', function(hadError) {
        modbus.connected = false;
        modbus.connecting = false;
        handleCallback(hadError);

    });

    this._client.on('error', function(e) {
        modbus.connected = false;
        modbus.connecting = false;
        handleCallback(e);
        modbus._client.end();
    });


    this.connect();
    this.setupReconnector();
};
util.inherits(ComOverTcpPort, EventEmitter);

ComOverTcpPort.prototype.setupReconnector = function () {
    setInterval(function(){
       // if(this.openFlag){
            if(!this.connected && !this.connecting){
                console.log('ComOverTcpPort reconnect to server...'+this.ip +":"+this.port);
                if(this._client){
                    this._client.removeAllListeners();
                    this._client.end();
                    this._client.destroy();
                    delete this._client;
                    this._client = null;
                    this.ReleasePort(this.port);
                }

                // process.exit(0);
                this._client = new net.Socket();
                this.connect();
            }
       // }

    }.bind(this),3000);

};
ComOverTcpPort.prototype.connect = function(){

    this.connecting = true;
    this._client.connect(this.port, this.ip);

}
/**
 * Simulate successful port open
 */
ComOverTcpPort.prototype.open = function (callback) {

    this.openFlag = true;
    this.callback = callback;

};

/**
 * Simulate successful close port
 */
ComOverTcpPort.prototype.close = function (callback) {
    this.callback = callback;
    this.openFlag = false;
    this._client.end();
};

/**
 * Check if port is open
 */
ComOverTcpPort.prototype.isOpen = function() {
    return this.connected;
};

/**
 * Send data to a modbus-tcp slave
 */
ComOverTcpPort.prototype.write = function (data) {
    this.writeStarted = true;
    /*
    // get next transaction id
    var transactionsId = (this._transactionId + 1) % MAX_TRANSACTIONS;
    // remove crc and add mbap
    var buffer = new Buffer(data.length + 6 - 2);
    buffer.writeUInt16BE(transactionsId, 0);
    buffer.writeUInt16BE(0, 2);
    buffer.writeUInt16BE(data.length - 2, 4);
    data.copy(buffer, 6);
    */
    if(_.isFunction(data.copy)){
        var buffer = new Buffer(data.length);
        data.copy(buffer,0,0, data.length);
        // send buffer to slave
        this._client.write(buffer);
    }else{
        var buffer = data.split(' ').map(function (data) {
            return parseInt(data, 16);
        });
        this._client.write(new Buffer(buffer));
    }

};

ComOverTcpPort.prototype.ReleasePort = function (port) {
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

module.exports = ComOverTcpPort;

