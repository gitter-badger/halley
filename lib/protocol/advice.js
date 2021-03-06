'use strict';

var Events = require('../util/externals').Events;
var extend = require('../util/externals').extend;
var debug  = require('debug')('halley:advice');

var DEFAULT_MAX_NETWORK_DELAY = 30000;
var DEFAULT_CONNECT_TIMEOUT = 30000;
var DEFAULT_INTERVAL = 0;
var DEFAULT_TIMEOUT = 30000;
var DEFAULT_DISCONNECT_TIMEOUT = 10000;
var DEFAULT_RETRY_INTERVAL = 1000;

var ADVICE_HANDSHAKE = 'handshake';
var ADVICE_RETRY = 'retry';
var ADVICE_NONE = 'none';

/**
 * After three successive failures, make sure we're not trying to quickly
 */
var HANDSHAKE_FAILURE_THRESHOLD = 3;
var HANDSHAKE_FAILURE_MIN_INTERVAL = 1000;

var MAX_PING_INTERVAL = 50000; // 50 seconds
var MIN_PING_INTERVAL = 1000;

function Advice(options) {
  /* Server controlled values */

  var apply = function (key, defaultValue) {
    if (options[key] !== undefined) {
      this[key] = options[key];
    } else {
      this[key] = defaultValue;
    }
  }.bind(this);

  /**
   * An integer representing the minimum period of time, in milliseconds, for a
   * client to delay subsequent requests to the /meta/connect channel.
   * A negative period indicates that the message should not be retried.
   * A client MUST implement interval support, but a client MAY exceed the
   * interval provided by the server. A client SHOULD implement a backoff
   * strategy to increase the interval if requests to the server fail without
   * new advice being received from the server.
   */
  apply('interval', DEFAULT_INTERVAL);

  /**
   * An integer representing the period of time, in milliseconds, for the
   * server to delay responses to the /meta/connect channel.
   * This value is merely informative for clients. Bayeux servers SHOULD honor
   * timeout advices sent by clients.
   */
  apply('timeout', DEFAULT_TIMEOUT);

  /* Client values */

  /**
   * The amount of time to wait between successive retries on a
   * single message send
   */
  apply('retry', DEFAULT_RETRY_INTERVAL);


  /**
   * The maximum number of milliseconds to wait before considering a
   * request to the Bayeux server failed.
   */
  apply('maxNetworkDelay', DEFAULT_MAX_NETWORK_DELAY);

  /**
   * The maximum number of milliseconds to wait for a WebSocket connection to
   * be opened. It does not apply to HTTP connections.
   */
  apply('connectTimeout', DEFAULT_CONNECT_TIMEOUT);


  /**
   * Maximum time to wait on disconnect
   */
  apply('disconnectTimeout', DEFAULT_DISCONNECT_TIMEOUT);

  this._handshakes = 0;
}

Advice.prototype = {
  update: function(newAdvice) {
    var advice = this;

    var adviceUpdated = false;
    ['timeout', 'interval'].forEach(function(key) {
      if (newAdvice[key] && newAdvice[key] !== advice[key]) {
        adviceUpdated = true;
        advice[key] = newAdvice[key];
      }
    });

    if (adviceUpdated) {
      debug('Advice updated to interval=%s, timeout=%s using %j', this.interval, this.timeout, newAdvice);
    }

    switch(newAdvice.reconnect) {
      case ADVICE_HANDSHAKE:
        this.trigger('advice:handshake');
        break;

      case ADVICE_NONE:
        this.trigger('advice:none');
        break;
    }

  },

  handshakeFailed: function() {
    this._handshakes++;
  },

  handshakeSuccess: function() {
    this._handshakes = 0;
  },

  getMaxNetworkDelay: function() {
    return Math.min(this.timeout, this.maxNetworkDelay);
  },

  getHandshakeInterval: function() {
    var interval = this.interval;

    if (this._handshakes > HANDSHAKE_FAILURE_THRESHOLD && interval < HANDSHAKE_FAILURE_MIN_INTERVAL) {
      return HANDSHAKE_FAILURE_MIN_INTERVAL;
    }

    return interval;
  },

  getDisconnectTimeout: function() {
    return Math.min(this.timeout, this.disconnectTimeout);
  },

  getPingInterval: function() {
    // If the interval exceeds a minute theres a good chance an ELB or
    // intermediate proxy will shut the connection down, so we set
    // the interval to 50 seconds max
    var pingInterval = this.timeout / 2;
    return withinRange(pingInterval, MIN_PING_INTERVAL, MAX_PING_INTERVAL);
  }

};

extend(Advice.prototype, Events);


/**
 * Ensure `value` is within [min, max]
 */
function withinRange(value, min, max) {
  if (isNaN(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

module.exports = Advice;
