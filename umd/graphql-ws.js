(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.graphqlWs = {}));
}(this, (function (exports) { 'use strict';

    // Extremely small optimisation, reduces runtime prototype traversal
    const baseHasOwnProperty = Object.prototype.hasOwnProperty;
    /** @private */
    function isObject(val) {
        return typeof val === 'object' && val !== null;
    }
    /** @private */
    function areGraphQLErrors(obj) {
        return (Array.isArray(obj) &&
            // must be at least one error
            obj.length > 0 &&
            // error has at least a message
            obj.every((ob) => 'message' in ob));
    }
    /** @private */
    function hasOwnProperty(obj, prop) {
        return baseHasOwnProperty.call(obj, prop);
    }
    /** @private */
    function hasOwnObjectProperty(obj, prop) {
        return baseHasOwnProperty.call(obj, prop) && isObject(obj[prop]);
    }
    /** @private */
    function hasOwnStringProperty(obj, prop) {
        return baseHasOwnProperty.call(obj, prop) && typeof obj[prop] === 'string';
    }

    /**
     *
     * common
     *
     */
    /**
     * The WebSocket sub-protocol used for the [GraphQL over WebSocket Protocol](/PROTOCOL.md).
     *
     * @category Common
     */
    const GRAPHQL_TRANSPORT_WS_PROTOCOL = 'graphql-transport-ws';
    /**
     * `graphql-ws` expected and standard close codes of the [GraphQL over WebSocket Protocol](/PROTOCOL.md).
     *
     * @category Common
     */
    exports.CloseCode = void 0;
    (function (CloseCode) {
        CloseCode[CloseCode["InternalServerError"] = 4500] = "InternalServerError";
        CloseCode[CloseCode["BadRequest"] = 4400] = "BadRequest";
        /** Tried subscribing before connect ack */
        CloseCode[CloseCode["Unauthorized"] = 4401] = "Unauthorized";
        CloseCode[CloseCode["Forbidden"] = 4403] = "Forbidden";
        CloseCode[CloseCode["SubprotocolNotAcceptable"] = 4406] = "SubprotocolNotAcceptable";
        CloseCode[CloseCode["ConnectionInitialisationTimeout"] = 4408] = "ConnectionInitialisationTimeout";
        CloseCode[CloseCode["ConnectionAcknowledgementTimeout"] = 4504] = "ConnectionAcknowledgementTimeout";
        /** Subscriber distinction is very important */
        CloseCode[CloseCode["SubscriberAlreadyExists"] = 4409] = "SubscriberAlreadyExists";
        CloseCode[CloseCode["TooManyInitialisationRequests"] = 4429] = "TooManyInitialisationRequests";
    })(exports.CloseCode || (exports.CloseCode = {}));
    /**
     * Types of messages allowed to be sent by the client/server over the WS protocol.
     *
     * @category Common
     */
    exports.MessageType = void 0;
    (function (MessageType) {
        MessageType["ConnectionInit"] = "connection_init";
        MessageType["ConnectionAck"] = "connection_ack";
        MessageType["Ping"] = "ping";
        MessageType["Pong"] = "pong";
        MessageType["Subscribe"] = "start";
        MessageType["Next"] = "next";
        MessageType["Error"] = "error";
        MessageType["Complete"] = "complete";
    })(exports.MessageType || (exports.MessageType = {}));
    /**
     * Checks if the provided value is a message.
     *
     * @category Common
     */
    function isMessage(val) {
        if (isObject(val)) {
            // all messages must have the `type` prop
            if (!hasOwnStringProperty(val, 'type')) {
                return false;
            }
            // validate other properties depending on the `type`
            switch (val.type) {
                case exports.MessageType.ConnectionInit:
                    // the connection init message can have optional payload object
                    return (!hasOwnProperty(val, 'payload') ||
                        val.payload === undefined ||
                        isObject(val.payload));
                case exports.MessageType.ConnectionAck:
                case exports.MessageType.Ping:
                case exports.MessageType.Pong:
                    // the connection ack, ping and pong messages can have optional payload object too
                    return (!hasOwnProperty(val, 'payload') ||
                        val.payload === undefined ||
                        isObject(val.payload));
                case exports.MessageType.Subscribe:
                    return (hasOwnStringProperty(val, 'id') &&
                        hasOwnObjectProperty(val, 'payload') &&
                        (!hasOwnProperty(val.payload, 'operationName') ||
                            val.payload.operationName === undefined ||
                            val.payload.operationName === null ||
                            typeof val.payload.operationName === 'string') &&
                        hasOwnStringProperty(val.payload, 'query') &&
                        (!hasOwnProperty(val.payload, 'variables') ||
                            val.payload.variables === undefined ||
                            val.payload.variables === null ||
                            hasOwnObjectProperty(val.payload, 'variables')) &&
                        (!hasOwnProperty(val.payload, 'extensions') ||
                            val.payload.extensions === undefined ||
                            val.payload.extensions === null ||
                            hasOwnObjectProperty(val.payload, 'extensions')));
                case exports.MessageType.Next:
                    return (hasOwnStringProperty(val, 'id') &&
                        hasOwnObjectProperty(val, 'payload'));
                case exports.MessageType.Error:
                    return hasOwnStringProperty(val, 'id') && areGraphQLErrors(val.payload);
                case exports.MessageType.Complete:
                    return hasOwnStringProperty(val, 'id');
                default:
                    return false;
            }
        }
        return false;
    }
    /**
     * Parses the raw websocket message data to a valid message.
     *
     * @category Common
     */
    function parseMessage(data, reviver) {
        if (isMessage(data)) {
            return data;
        }
        if (typeof data !== 'string') {
            throw new Error('Message not parsable');
        }
        const message = JSON.parse(data, reviver);
        if (!isMessage(message)) {
            throw new Error('Invalid message');
        }
        return message;
    }
    /**
     * Stringifies a valid message ready to be sent through the socket.
     *
     * @category Common
     */
    function stringifyMessage(msg, replacer) {
        if (!isMessage(msg)) {
            throw new Error('Cannot stringify invalid message');
        }
        return JSON.stringify(msg, replacer);
    }

    /**
     *
     * client
     *
     */
    /**
     * Creates a disposable GraphQL over WebSocket client.
     *
     * @category Client
     */
    function createClient(options) {
        const { url, connectionParams, lazy = true, onNonLazyError = console.error, lazyCloseTimeout = 0, keepAlive = 0, disablePong, connectionAckWaitTimeout = 0, retryAttempts = 5, retryWait = async function randomisedExponentialBackoff(retries) {
            let retryDelay = 1000; // start with 1s delay
            for (let i = 0; i < retries; i++) {
                retryDelay *= 2;
            }
            await new Promise((resolve) => setTimeout(resolve, retryDelay +
                // add random timeout from 300ms to 3s
                Math.floor(Math.random() * (3000 - 300) + 300)));
        }, isFatalConnectionProblem = (errOrCloseEvent) => 
        // non `CloseEvent`s are fatal by default
        !isLikeCloseEvent(errOrCloseEvent), on, webSocketImpl, 
        /**
         * Generates a v4 UUID to be used as the ID using `Math`
         * as the random number generator. Supply your own generator
         * in case you need more uniqueness.
         *
         * Reference: https://gist.github.com/jed/982883
         */
        generateID = function generateUUID() {
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0, v = c == 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        }, jsonMessageReplacer: replacer, jsonMessageReviver: reviver, } = options;
        let ws;
        if (webSocketImpl) {
            if (!isWebSocket(webSocketImpl)) {
                throw new Error('Invalid WebSocket implementation provided');
            }
            ws = webSocketImpl;
        }
        else if (typeof WebSocket !== 'undefined') {
            ws = WebSocket;
        }
        else if (typeof global !== 'undefined') {
            ws =
                global.WebSocket ||
                    // @ts-expect-error: Support more browsers
                    global.MozWebSocket;
        }
        else if (typeof window !== 'undefined') {
            ws =
                window.WebSocket ||
                    // @ts-expect-error: Support more browsers
                    window.MozWebSocket;
        }
        if (!ws)
            throw new Error('WebSocket implementation missing');
        const WebSocketImpl = ws;
        // websocket status emitter, subscriptions are handled differently
        const emitter = (() => {
            const message = (() => {
                const listeners = {};
                return {
                    on(id, listener) {
                        listeners[id] = listener;
                        return () => {
                            delete listeners[id];
                        };
                    },
                    emit(message) {
                        var _a;
                        if ('id' in message)
                            (_a = listeners[message.id]) === null || _a === void 0 ? void 0 : _a.call(listeners, message);
                    },
                };
            })();
            const listeners = {
                connecting: (on === null || on === void 0 ? void 0 : on.connecting) ? [on.connecting] : [],
                opened: (on === null || on === void 0 ? void 0 : on.opened) ? [on.opened] : [],
                connected: (on === null || on === void 0 ? void 0 : on.connected) ? [on.connected] : [],
                ping: (on === null || on === void 0 ? void 0 : on.ping) ? [on.ping] : [],
                pong: (on === null || on === void 0 ? void 0 : on.pong) ? [on.pong] : [],
                message: (on === null || on === void 0 ? void 0 : on.message) ? [message.emit, on.message] : [message.emit],
                closed: (on === null || on === void 0 ? void 0 : on.closed) ? [on.closed] : [],
                error: (on === null || on === void 0 ? void 0 : on.error) ? [on.error] : [],
            };
            return {
                onMessage: message.on,
                on(event, listener) {
                    const l = listeners[event];
                    l.push(listener);
                    return () => {
                        l.splice(l.indexOf(listener), 1);
                    };
                },
                emit(event, ...args) {
                    for (const listener of listeners[event]) {
                        // @ts-expect-error: The args should fit
                        listener(...args);
                    }
                },
            };
        })();
        let connecting, locks = 0, retrying = false, retries = 0, disposed = false;
        async function connect() {
            const [socket, throwOnClose] = await (connecting !== null && connecting !== void 0 ? connecting : (connecting = new Promise((connected, denied) => (async () => {
                if (retrying) {
                    await retryWait(retries);
                    // subscriptions might complete while waiting for retry
                    if (!locks) {
                        connecting = undefined;
                        return denied({ code: 1000, reason: 'All Subscriptions Gone' });
                    }
                    retries++;
                }
                emitter.emit('connecting');
                const socket = new WebSocketImpl(typeof url === 'function' ? await url() : url, GRAPHQL_TRANSPORT_WS_PROTOCOL);
                let connectionAckTimeout, queuedPing;
                function enqueuePing() {
                    if (isFinite(keepAlive) && keepAlive > 0) {
                        clearTimeout(queuedPing); // in case where a pong was received before a ping (this is valid behaviour)
                        queuedPing = setTimeout(() => {
                            if (socket.readyState === WebSocketImpl.OPEN) {
                                socket.send(stringifyMessage({ type: exports.MessageType.Ping }));
                                emitter.emit('ping', false, undefined);
                            }
                        }, keepAlive);
                    }
                }
                socket.onerror = (err) => {
                    // we let the onclose reject the promise for correct retry handling
                    emitter.emit('error', err);
                };
                socket.onclose = (event) => {
                    connecting = undefined;
                    clearTimeout(connectionAckTimeout);
                    clearTimeout(queuedPing);
                    emitter.emit('closed', event);
                    denied(event);
                };
                socket.onopen = async () => {
                    try {
                        emitter.emit('opened', socket);
                        const payload = typeof connectionParams === 'function'
                            ? await connectionParams()
                            : connectionParams;
                        console.log("Sending initial Message");
                        socket.send(stringifyMessage(payload
                            ? {
                                type: exports.MessageType.ConnectionInit,
                                payload,
                            }
                            : {
                                type: exports.MessageType.ConnectionInit,
                                // payload is completely absent if not provided
                            }, replacer));
                        if (isFinite(connectionAckWaitTimeout) &&
                            connectionAckWaitTimeout > 0) {
                            connectionAckTimeout = setTimeout(() => {
                                socket.close(exports.CloseCode.ConnectionAcknowledgementTimeout, 'Connection acknowledgement timeout');
                            }, connectionAckWaitTimeout);
                        }
                        enqueuePing(); // enqueue ping (noop if disabled)
                    }
                    catch (err) {
                        socket.close(exports.CloseCode.BadRequest, err instanceof Error ? err.message : new Error(err).message);
                    }
                };
                let acknowledged = false;
                socket.onmessage = ({ data }) => {
                    try {
                        const message = parseMessage(data, reviver);
                        emitter.emit('message', message);
                        if (message.type === 'ping' || message.type === 'pong') {
                            emitter.emit(message.type, true, message.payload); // received
                            if (message.type === 'pong') {
                                enqueuePing(); // enqueue next ping (noop if disabled)
                            }
                            else if (!disablePong) {
                                // respond with pong on ping
                                socket.send(stringifyMessage(message.payload
                                    ? {
                                        type: exports.MessageType.Pong,
                                        payload: message.payload,
                                    }
                                    : {
                                        type: exports.MessageType.Pong,
                                        // payload is completely absent if not provided
                                    }));
                                emitter.emit('pong', false, message.payload);
                            }
                            return; // ping and pongs can be received whenever
                        }
                        if (acknowledged)
                            return; // already connected and acknowledged
                        console.log("SENDING ACK");
                        if (message.type !== exports.MessageType.ConnectionAck)
                            throw new Error(`First message cannot be of type ${message.type}`);
                        clearTimeout(connectionAckTimeout);
                        acknowledged = true;
                        emitter.emit('connected', socket, message.payload); // connected = socket opened + acknowledged
                        retrying = false; // future lazy connects are not retries
                        retries = 0; // reset the retries on connect
                        connected([
                            socket,
                            new Promise((_, closed) => socket.addEventListener('close', closed)),
                        ]);
                    }
                    catch (err) {
                        socket.close(exports.CloseCode.BadRequest, err instanceof Error ? err.message : new Error(err).message);
                    }
                };
            })())));
            // if the provided socket is in a closing state, wait for the throw on close
            if (socket.readyState === WebSocketImpl.CLOSING)
                await throwOnClose;
            let release = () => {
                // releases this connection
            };
            const released = new Promise((resolve) => (release = resolve));
            return [
                socket,
                release,
                Promise.race([
                    // wait for
                    released.then(() => {
                        if (!locks) {
                            // and if no more locks are present, complete the connection
                            const complete = () => socket.close(1000, 'Normal Closure');
                            if (isFinite(lazyCloseTimeout) && lazyCloseTimeout > 0) {
                                // if the keepalive is set, allow for the specified calmdown time and
                                // then complete. but only if no lock got created in the meantime and
                                // if the socket is still open
                                setTimeout(() => {
                                    if (!locks && socket.readyState === WebSocketImpl.OPEN)
                                        complete();
                                }, lazyCloseTimeout);
                            }
                            else {
                                // otherwise complete immediately
                                complete();
                            }
                        }
                    }),
                    // or
                    throwOnClose,
                ]),
            ];
        }
        /**
         * Checks the `connect` problem and evaluates if the client should retry.
         */
        function shouldRetryConnectOrThrow(errOrCloseEvent) {
            // some close codes are worth reporting immediately
            if (isLikeCloseEvent(errOrCloseEvent) &&
                (isFatalInternalCloseCode(errOrCloseEvent.code) ||
                    [
                        exports.CloseCode.InternalServerError,
                        exports.CloseCode.BadRequest,
                        exports.CloseCode.Unauthorized,
                        // CloseCode.Forbidden, might grant access out after retry
                        exports.CloseCode.SubprotocolNotAcceptable,
                        // CloseCode.ConnectionInitialisationTimeout, might not time out after retry
                        // CloseCode.ConnectionAcknowledgementTimeout, might not time out after retry
                        exports.CloseCode.SubscriberAlreadyExists,
                        exports.CloseCode.TooManyInitialisationRequests,
                    ].includes(errOrCloseEvent.code)))
                throw errOrCloseEvent;
            // client was disposed, no retries should proceed regardless
            if (disposed)
                return false;
            // normal closure (possibly all subscriptions have completed)
            // if no locks were acquired in the meantime, shouldnt try again
            if (isLikeCloseEvent(errOrCloseEvent) && errOrCloseEvent.code === 1000)
                return locks > 0;
            // retries are not allowed or we tried to many times, report error
            if (!retryAttempts || retries >= retryAttempts)
                throw errOrCloseEvent;
            // throw fatal connection problems immediately
            if (isFatalConnectionProblem(errOrCloseEvent))
                throw errOrCloseEvent;
            // looks good, start retrying
            return (retrying = true);
        }
        // in non-lazy (hot?) mode always hold one connection lock to persist the socket
        if (!lazy) {
            (async () => {
                locks++;
                for (;;) {
                    try {
                        const [, , throwOnClose] = await connect();
                        await throwOnClose; // will always throw because releaser is not used
                    }
                    catch (errOrCloseEvent) {
                        try {
                            if (!shouldRetryConnectOrThrow(errOrCloseEvent))
                                return;
                        }
                        catch (errOrCloseEvent) {
                            // report thrown error, no further retries
                            return onNonLazyError === null || onNonLazyError === void 0 ? void 0 : onNonLazyError(errOrCloseEvent);
                        }
                    }
                }
            })();
        }
        return {
            on: emitter.on,
            subscribe(payload, sink) {
                const id = generateID();
                let done = false, errored = false, releaser = () => {
                    // for handling completions before connect
                    locks--;
                    done = true;
                };
                (async () => {
                    locks++;
                    for (;;) {
                        try {
                            const [socket, release, waitForReleaseOrThrowOnClose] = await connect();
                            // if done while waiting for connect, release the connection lock right away
                            if (done)
                                return release();
                            const unlisten = emitter.onMessage(id, (message) => {
                                switch (message.type) {
                                    case exports.MessageType.Next: {
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        sink.next(message.payload);
                                        return;
                                    }
                                    case exports.MessageType.Error: {
                                        (errored = true), (done = true);
                                        sink.error(message.payload);
                                        releaser();
                                        return;
                                    }
                                    case exports.MessageType.Complete: {
                                        done = true;
                                        releaser(); // release completes the sink
                                        return;
                                    }
                                }
                            });
                            socket.send(stringifyMessage({
                                id,
                                type: exports.MessageType.Subscribe,
                                payload,
                            }, replacer));
                            releaser = () => {
                                if (!done && socket.readyState === WebSocketImpl.OPEN)
                                    // if not completed already and socket is open, send complete message to server on release
                                    socket.send(stringifyMessage({
                                        id,
                                        type: exports.MessageType.Complete,
                                    }, replacer));
                                locks--;
                                done = true;
                                release();
                            };
                            // either the releaser will be called, connection completed and
                            // the promise resolved or the socket closed and the promise rejected.
                            // whatever happens though, we want to stop listening for messages
                            await waitForReleaseOrThrowOnClose.finally(unlisten);
                            return; // completed, shouldnt try again
                        }
                        catch (errOrCloseEvent) {
                            if (!shouldRetryConnectOrThrow(errOrCloseEvent))
                                return;
                        }
                    }
                })()
                    .catch(sink.error) // rejects on close events and errors
                    .then(() => {
                    // delivering either an error or a complete terminates the sequence
                    if (!errored)
                        sink.complete();
                }); // resolves on release or normal closure
                return () => {
                    // dispose only of active subscriptions
                    if (!done)
                        releaser();
                };
            },
            async dispose() {
                disposed = true;
                if (connecting) {
                    // if there is a connection, close it
                    const [socket] = await connecting;
                    socket.close(1000, 'Normal Closure');
                }
            },
        };
    }
    function isLikeCloseEvent(val) {
        return isObject(val) && 'code' in val && 'reason' in val;
    }
    function isFatalInternalCloseCode(code) {
        if ([
            1000,
            1001,
            1006,
            1005,
            1012,
            1013,
            1013, // Bad Gateway
        ].includes(code))
            return false;
        // all other internal errors are fatal
        return code >= 1000 && code <= 1999;
    }
    function isWebSocket(val) {
        return (typeof val === 'function' &&
            'constructor' in val &&
            'CLOSED' in val &&
            'CLOSING' in val &&
            'CONNECTING' in val &&
            'OPEN' in val);
    }

    exports.GRAPHQL_TRANSPORT_WS_PROTOCOL = GRAPHQL_TRANSPORT_WS_PROTOCOL;
    exports.createClient = createClient;
    exports.isMessage = isMessage;
    exports.parseMessage = parseMessage;
    exports.stringifyMessage = stringifyMessage;

    Object.defineProperty(exports, '__esModule', { value: true });

})));
