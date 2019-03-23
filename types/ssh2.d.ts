export = client;
declare class client {
    // Circular reference from client
    static Client: any;
    static SFTP_OPEN_MODE: {
        APPEND: number;
        CREAT: number;
        EXCL: number;
        READ: number;
        TRUNC: number;
        WRITE: number;
    };
    static SFTP_STATUS_CODE: {
        "0": string;
        "1": string;
        "2": string;
        "3": string;
        "4": string;
        "5": string;
        "6": string;
        "7": string;
        "8": string;
        BAD_MESSAGE: number;
        CONNECTION_LOST: number;
        EOF: number;
        FAILURE: number;
        NO_CONNECTION: number;
        NO_SUCH_FILE: number;
        OK: number;
        OP_UNSUPPORTED: number;
        PERMISSION_DENIED: number;
    };
    config: any;
    addListener(type: any, listener: any): any;
    connect(cfg: any): void;
    destroy(): void;
    emit(type: any, args: any): any;
    end(): any;
    eventNames(): any;
    exec(cmd: any, opts: any, cb: any): any;
    forwardIn(bindAddr: any, bindPort: any, cb: any): any;
    forwardOut(srcIP: any, srcPort: any, dstIP: any, dstPort: any, cb: any): any;
    getMaxListeners(): any;
    listenerCount(type: any): any;
    listeners(type: any): any;
    off(type: any, listener: any): any;
    on(type: any, listener: any): any;
    once(type: any, listener: any): any;
    openssh_forwardInStreamLocal(socketPath: any, cb: any): any;
    openssh_forwardOutStreamLocal(socketPath: any, cb: any): any;
    openssh_noMoreSessions(cb: any): any;
    openssh_unforwardInStreamLocal(socketPath: any, cb: any): any;
    prependListener(type: any, listener: any): any;
    prependOnceListener(type: any, listener: any): any;
    rawListeners(type: any): any;
    removeAllListeners(type: any, ...args: any[]): any;
    removeListener(type: any, listener: any): any;
    setMaxListeners(n: any): any;
    sftp(cb: any): any;
    shell(wndopts: any, opts: any, cb: any): any;
    subsys(name: any, cb: any): any;
    unforwardIn(bindAddr: any, bindPort: any, cb: any): any;
}
declare namespace client {
    class Server {
        static IncomingClient(stream: any, socket: any): void;
        static KEEPALIVE_CLIENT_COUNT_MAX: number;
        static KEEPALIVE_CLIENT_INTERVAL: number;
        static KEEPALIVE_INTERVAL: number;
        static createServer(cfg: any, listener: any): any;
        constructor(cfg: any, listener: any);
        maxConnections: any;
        addListener(type: any, listener: any): any;
        address(): any;
        close(cb: any): any;
        emit(type: any, args: any): any;
        eventNames(): any;
        getConnections(cb: any): void;
        getMaxListeners(): any;
        listen(...args: any[]): any;
        listenerCount(type: any): any;
        listeners(type: any): any;
        off(type: any, listener: any): any;
        on(type: any, listener: any): any;
        once(type: any, listener: any): any;
        prependListener(type: any, listener: any): any;
        prependOnceListener(type: any, listener: any): any;
        rawListeners(type: any): any;
        ref(): void;
        removeAllListeners(type: any, ...args: any[]): any;
        removeListener(type: any, listener: any): any;
        setMaxListeners(n: any): any;
        unref(): void;
    }
    namespace utils {
        function DSASigBERToBare(signature: any): any;
        function ECDSASigASN1ToSSH(signature: any): any;
        function iv_inc(iv: any): void;
        function parseKey(data: any, passphrase: any): any;
        function readInt(buffer: any, start: any, stream: any, cb: any): any;
        function readString(buffer: any, start: any, encoding: any, stream: any, cb: any, maxLen: any): any;
        function sigSSHToASN1(sig: any, type: any, self: any, callback: any): any;
    }
}
