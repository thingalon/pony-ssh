from collections import deque
import logging
import os
import shutil
import stat

from definitions import Opcode, ParcelType
from errors import Error
from tools import processStat
from protocol import sendResponseHeader, sendParcel, sendEmptyParcel, sendError

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

messageHandlers = {
    Opcode.LS:              handleLs,
    Opcode.GET_SERVER_INFO: handleGetServerInfo,
    Opcode.FILE_READ:       handleFileRead,
    Opcode.FILE_WRITE:      handleFileWrite,
    Opcode.MKDIR:           handleMkdir,
    Opcode.DELETE:          handleDelete,
    Opcode.RENAME:          handleRename,
}
