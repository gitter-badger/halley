'use strict';

var Transport    = require('./transport');
var uri          = require('../util/uri');
var Promise      = require('bluebird');
var debug        = require('debug')('halley:websocket');
var inherits     = require('inherits');
var extend        = require('../util/externals').extend;
var globalEvents = require('../util/global-events');

var WS_CONNECTING  = 0;
var WS_OPEN = 1;
var WS_CLOSING = 2;
var WS_CLOSED  = 3;

var PROTOCOLS = {
  'http:':  'ws:',
  'https:': 'wss:'
};

function getSocketUrl(endpoint) {
  endpoint = extend({ }, endpoint);
  endpoint.protocol = PROTOCOLS[endpoint.protocol];
  return uri.stringify(endpoint);
}

function WebSocketTransport(dispatcher, endpoint, advice) {
  WebSocketTransport.super_.call(this, dispatcher, endpoint, advice);

  this._advice         = advice;
  this._pingTimer      = null;
  this._pingResolves   = null;
  this._connectPromise = this._createConnectPromise();
}
inherits(WebSocketTransport, Transport);

extend(WebSocketTransport.prototype, {
  /* Abstract _createWebsocket: function(url) { } */

  /**
   * Connects and returns a promise that resolves when the connection is
   * established
   */
  connect: function() {
    return this._connectPromise || Promise.reject(new Error('Socket disconnected'));
  },

  close: function() {
    /* Only perform close once */
    if (!this._connectPromise) return;
    this._connectPromise = null;
    this._dispatcher.transportDown(this);

    clearTimeout(this._pingTimer);

    globalEvents.off('network', this._pingNow, this);
    globalEvents.off('sleep', this._pingNow, this);

    var socket = this._socket;
    if (socket) {
      debug('Closing websocket');

      this._socket = null;

      var state = socket.readyState;
      socket.onerror = socket.onclose = socket.onmessage = null;

      if(state === WS_OPEN || state === WS_CONNECTING) {
        socket.close();
      }
    }
  },

  /* Returns a request */
  request: function(messages) {
    return this.connect()
      .bind(this)
      .then(function() {
        var socket = this._socket;
        if (!socket || socket.readyState !== WS_OPEN) {
          throw new Error('Websocket unavailable');
        }

        socket.send(JSON.stringify(messages));
      });
  },

  /**
   * Returns a promise of a connected socket.
   */
  _createConnectPromise: Promise.method(function() {
    debug('Entered connecting state, creating new WebSocket connection');

    var url = getSocketUrl(this.endpoint);
    var socket = this._socket = this._createWebsocket(url);

    if (!socket) {
      throw new Error('Sockets not supported');
    }

    return new Promise(function(resolve, reject) {

      switch (socket.readyState) {
        case WS_OPEN:
          resolve(socket);
          break;

        case WS_CONNECTING:
          break;

        case WS_CLOSING:
        case WS_CLOSED:
          reject(new Error('Socket connection failed'));
          return;
      }

      socket.onopen = function() {
        resolve(socket);
      };

      var self = this;
      socket.onmessage = function(e) {
        debug('Received message: %s', e.data);
        self._onmessage(e);
      };

      socket.onerror = function() {
        debug('WebSocket error');
        self.close();
        reject(new Error("Websocket connection failed before opening"));
      };

      socket.onclose = function(e) {
        debug('Websocket closed. code=%s reason=%s', e.code, e.reason);
        self.close();
        reject(new Error("Websocket connection failed: code=" + e.code + ": " + e.reason));
      };
    }.bind(this))
    .bind(this)
    .timeout(this._advice.connectTimeout, 'Websocket connect timeout')
    .then(function(socket) {
      // Connect success, setup listeners
      this._pingTimer = setTimeout(this._pingInterval.bind(this), this._advice.getPingInterval());

      globalEvents.on('network', this._pingNow, this);
      globalEvents.on('sleep', this._pingNow, this);
      return socket;
    })
    .catch(function(e) {
      this.close();
      throw e;
    });
  }),

  _onmessage: function(e) {
    var replies = JSON.parse(e.data);
    if (!replies) return;

    /* Resolve any outstanding pings */
    if (this._pingResolves) {
      this._pingResolves.forEach(function(resolve) {
        resolve();
      });

      this._pingResolves = null;
    }


    replies = [].concat(replies);

    this._receive(replies);
  },

  _ping: function() {
    debug('ping');

    return this.connect()
      .bind(this)
      .then(function(socket) {
        // Todo: deal with a timeout situation...
        if(socket.readyState !== WS_OPEN) {
          throw new Error('Socket not open');
        }

        return new Promise(function(resolve) {
            if (this._pingResolves) {
              this._pingResolves.push(resolve);
            } else {
              this._pingResolves = [resolve];
            }
            // resolveFn = resolve;
            // this.once('message', resolveFn);
            socket.send("[]");
          }.bind(this))
          .bind(this)
          .timeout(this._advice.getMaxNetworkDelay(), 'Ping timeout')
          .catch(function(err) {
            this.close();
            throw err;
          });
      });
  },

  /**
   * If we have reason to believe that the connection may be flaky, for
   * example, the computer has been asleep for a while, we send a ping
   * immediately (don't batch with other ping replies)
   */
  _pingNow: function() {
    this._ping()
      .bind(this)
      .catch(function(err) {
        debug('Ping failure: closing socket: %s', err && err.stack || err);
      });
  },

  _pingInterval: function() {
    this._ping()
      .bind(this)
      .then(function() {
        this._pingTimer = setTimeout(this._pingInterval.bind(this), this._advice.getPingInterval());
      })
      .catch(function(err) {
        debug('Interval ping failure: closing socket: %s', err && err.stack || err);
      });
    }
});

module.exports = WebSocketTransport;
