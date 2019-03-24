from collections import deque
import errno
import logging
import msgpack
import os
import shutil
import stat
import sys
import traceback

logging.basicConfig(filename=os.path.expanduser('~/.pony-ssh/debug.log'), level=logging.DEBUG)

class ParcelType:
    HEADER    = 0x01
    BODY      = 0x02
    ERROR     = 0x03
    ENDOFBODY = 0x04

class Opcode:
    LS              = 0x01
    GET_SERVER_INFO = 0x02
    FILE_READ       = 0x03
    FILE_WRITE      = 0x04
    MKDIR           = 0x05
    DELETE          = 0x06
    RENAME          = 0x07

class Error:
    OK      = 0
    EPERM   = 1  # Operation not permitted
    ENOENT  = 2  # No such file / directory
    EIO     = 5  # IO error
    EBADF   = 9  # Bad file number
    EAGAIN  = 11 # Try again
    EACCES  = 13 # Access denied
    EBUSY   = 16 # Device busy
    EEXIST  = 17 # File exists
    EXDEV   = 18 # Cross-device link
    ENODEV  = 19 # No such device
    ENOTDIR = 20 # Not a directory
    EINVAL  = 22 # Invalid argument
    EROFS   = 30 # Read-only filesystem
    ERANGE  = 34 # Out of range
    ENOSYS  = 38 # Function not implemented
    ENODATA = 61 # No data available

class FileType:
    FILE      = 0x01
    DIRECTORY = 0x02
    SYMLINK   = 0x10

class MessageReader:
    def __init__(self):
        self.messageSize = 0

    def readMessageSize(self):
        packHeader = sys.stdin.read(1)
        readSize = { 0xcc: 1, 0xcd: 2, 0xce: 4, 0xcf: 8 }.get(ord(packHeader), 0)
        packHeader += sys.stdin.read(readSize)
        self.messageSize = msgpack.unpackb(packHeader, raw=False)

    def read(self, bytes):
        if self.messageSize == 0:
            self.readMessageSize()

        readBytes = sys.stdin.read(min(16384, self.messageSize))
        self.messageSize -= len(readBytes)
        return readBytes

class CodedError(Exception):
    def __init__(self, code, message):
        super(CodedError, self).__init__(message)
        self.code = code
        self.message = message

def processInput():
    messageUnpacker = msgpack.Unpacker(MessageReader(), raw=False)
    for message in messageUnpacker:
        try:
            [opcode, args] = message
            handler = messageHandlers.get(opcode, None)
            if handler != None:
                handler(args)
            else:
                sendError(Error.EINVAL, "Unknown opcode: " + str(opcode))
        except CodedError as err:
            sendError(err.code, err.message)
        except OSError as err:
            logging.warning(err)
            sendError(processError(err.errno), err.strerror)
        except BaseException as err:
            logging.warning(err)
            sendError(Error.EINVAL, str(err) + '\n' + traceback.format_exc())
        finally:
            sys.stdout.flush()

def sendError(code, message):
    sendParcel(ParcelType.ERROR, msgpack.packb({ 'code': code, 'error': message }))

def sendResponseHeader(response):
    sendParcel(ParcelType.HEADER, msgpack.packb(response))

def sendParcel(type, data):
    sys.stdout.write(chr(type) + msgpack.packb(len(data)) + data)

def sendEmptyParcel():
    sys.stdout.write(msgpack.packb(0))

def handleLs(args):
    base = os.path.expanduser(args['path'])
    selfStat = os.stat(base)

    result = { 'stat': processStat(selfStat) }
    if not stat.S_ISDIR(selfStat[stat.ST_MODE]):
        sendResponseHeader(result)
        return

    dirs = {}
    dirLimit = 25
    entryLimit = 2000
    explore = deque(['.'])
    while len(explore) > 0 and dirLimit > 0 and entryLimit > 0:
        dirLimit -= 1

        relPath = explore.popleft()
        absPath = base if relPath == '.' else os.path.join(base, relPath)

        try:
            children = {}
            for childName in os.listdir(absPath):
                entryLimit -= 1
                if entryLimit < 0 and len(dirs) > 0:
                    children = None
                    break

                childStat = os.stat(os.path.join(absPath, childName))
                children[childName] = processStat(childStat)

                isDir = stat.S_ISDIR(childStat[stat.ST_MODE])
                if isDir and len(explore) < dirLimit:
                    explore.append(os.path.join(relPath, childName))
            
            if children is not None:
                dirs[relPath] = children
        except OSError as err:
            logging.warning('Error: ' + str(err))
            if len(dirs) == 0:
                raise err # Only raise read errors on the first item.

    result['dirs'] = dirs
    sendResponseHeader(result)

def handleGetServerInfo(args):
    settingsPath = os.path.expanduser('~/.pony-ssh/')
    if not os.path.exists(settingsPath):
        os.makedirs(settingsPath)

    # Load or generate a cache key.
    cacheKey = None
    cacheKeyIsNew = False
    cacheKeyFile = settingsPath + 'cache.key'
    if os.path.exists(cacheKeyFile):
        with open(cacheKeyFile, 'r') as keyFileHandle:
            cacheKey = keyFileHandle.read(64)

    if cacheKey == None or len(cacheKey) < 64:
        cacheKeyIsNew = True
        cacheKey = os.urandom(32).encode('hex')
        with open(cacheKeyFile, "w") as keyFileHandle:
            keyFileHandle.write(cacheKey)

    sendResponseHeader({ 'cacheKey': cacheKey, 'newCacheKey': cacheKeyIsNew })

def handleFileRead(args):
    path = os.path.expanduser(args['path'])

    # Open the file before sending a response header
    fh = open(path, 'r')

    length = os.path.getsize(path)
    sendResponseHeader({'length': length})

    if length == 0:
        return

    chunkSize = 200 * 1024
    while True:
        chunk = fh.read(chunkSize)
        if not chunk:
            break
        sendParcel(ParcelType.BODY, chunk)

    fh.close()

    sendParcel(ParcelType.ENDOFBODY, '')

def handleFileWrite(args):
    path = os.path.expanduser(args['path'])

    alreadyExists = os.path.exists(path)
    if alreadyExists and not args['overwrite']:
        raise OSError(Error.EEXIST, 'File already exists')
    elif not alreadyExists and not args['create']:
        raise OSError(Error.ENOENT, 'File not found')

    fh = open(path, 'w')
    fh.write(args['data'])
    fh.close()

    sendResponseHeader({})

def handleMkdir(args):
    path = os.path.expanduser(args['path'])
    os.mkdir(path)
    sendResponseHeader({})

def handleDelete(args):
    path = os.path.expanduser(args['path'])
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    else:
        os.remove(path)
    sendResponseHeader({})

def handleRename(args):
    fromPath = os.path.expanduser(args['from'])
    toPath = os.path.expanduser(args['to'])

    if os.path.exists(toPath):
        if args['overwrite']:
            os.unlink(toPath)
        else:
            raise OSError(Error.EEXIST, 'File already exists')

    os.rename(fromPath, toPath)
    sendResponseHeader({})

def processStat(osStat):
    mode = osStat[stat.ST_MODE]
    
    fileType = 0
    if stat.S_ISREG(mode):
        fileType = FileType.FILE
    elif stat.S_ISDIR(mode):
        fileType = FileType.DIRECTORY
    if stat.S_ISLNK(mode):
        fileType += FileType.SYMLINK

    return [
        fileType,
        osStat[stat.ST_MTIME],
        osStat[stat.ST_CTIME],
        osStat[stat.ST_SIZE]
    ]

def processError(osError):
    return {
        0:             Error.OK,
        errno.EPERM:   Error.EPERM,
        errno.ENOENT:  Error.ENOENT,
        errno.EIO:     Error.EIO,
        errno.EBADF:   Error.EBADF,
        errno.EAGAIN:  Error.EAGAIN,
        errno.EACCES:  Error.EACCES,
        errno.EBUSY:   Error.EBUSY,
        errno.EXDEV:   Error.EXDEV,
        errno.ENODEV:  Error.ENODEV,
        errno.ENOTDIR: Error.ENOTDIR,
        errno.EINVAL:  Error.EINVAL,
        errno.EROFS:   Error.EROFS,
        errno.ERANGE:  Error.ERANGE,
        errno.ENOSYS:  Error.ENOSYS,
        errno.ENODATA: Error.ENODATA,
    }.get(osError, Error.EINVAL)

messageHandlers = {
    Opcode.LS:              handleLs,
    Opcode.GET_SERVER_INFO: handleGetServerInfo,
    Opcode.FILE_READ:       handleFileRead,
    Opcode.FILE_WRITE:      handleFileWrite,
    Opcode.MKDIR:           handleMkdir,
    Opcode.DELETE:          handleDelete,
    Opcode.RENAME:          handleRename,
}

processInput()
