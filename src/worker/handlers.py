from collections import deque
import binascii
import hashlib
import logging
import os
import shutil
import stat
import tempfile
from io import open

from definitions import Opcode, ParcelType, DiffAction
from errors import Error, CodedError
from tools import process_stat
from protocol import send_response_header, send_parcel, send_empty_parcel, send_error

def handle_expand_path(args):
    path = os.path.expanduser(args['path'])
    if not os.path.exists(path):
        send_error(Error.ENOENT, 'Path not found')
    elif not os.path.isdir(path):
        send_error(Error.ENOTDIR, 'Not a directory')
    else:
        send_response_header({'path': path})

def handle_ls(args):
    base = os.path.expanduser(args['path'])
    selfStat = os.stat(base)

    result = { 'stat': process_stat(selfStat) }
    if not stat.S_ISDIR(selfStat[stat.ST_MODE]):
        send_response_header(result)
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

                child_path = os.path.join(absPath, childName)
                try:
                    childStat = os.stat(child_path)
                    children[childName] = process_stat(childStat)

                    isDir = stat.S_ISDIR(childStat[stat.ST_MODE])
                    if isDir and len(explore) < dirLimit:
                        explore.append(os.path.join(relPath, childName))
                except OSError as err:
                    logging.warning('Skipping ' + child_path + ': ' + str(err))

            if children is not None:
                dirs[relPath] = children
        except OSError as err:
            logging.warning('Error: ' + str(err))
            if len(dirs) == 0:
                raise err # Only raise read errors on the first item.

    result['dirs'] = dirs
    send_response_header(result)

def handle_get_server_info(args):
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
        cacheKey = binascii.hexlify(os.urandom(32))
        with open(cacheKeyFile, 'wb') as keyFileHandle:
            keyFileHandle.write(cacheKey)

    send_response_header({
        'home': os.path.expanduser('~'),
        'cacheKey': cacheKey,
        'newCacheKey': cacheKeyIsNew
    })

def handle_file_read(args):
    path = os.path.expanduser(args['path'])

    # Open the file before sending a response header
    fh = open(path, 'rb')

    # If a hash has been supplied, check if it matches. IF so, shortcut download.
    if 'cachedHash' in args:
        hash = hashlib.md5(fh.read()).hexdigest()
        if hash == args['cachedHash']:
            send_response_header({'hashMatch': True})
            return
        fh.seek(0, 0)

    length = os.path.getsize(path)
    send_response_header({'length': length})

    if length == 0:
        return

    chunkSize = 200 * 1024
    while True:
        chunk = fh.read(chunkSize)
        if not chunk:
            break
        send_parcel(ParcelType.BODY, chunk)

    fh.close()

    send_parcel(ParcelType.ENDOFBODY, b'')

def handle_file_write_diff(args):
    path = os.path.expanduser(args['path'])

    if not os.path.exists(path):
        raise OSError(Error.ENOENT, 'File not found')

    with open(path, 'r', encoding='latin-1') as fh:
        original_data = bytearray(fh.read(), 'latin-1')

    original_hash = hashlib.md5(original_data).hexdigest()
    if original_hash != args['hashBefore']:
        raise CodedError(Error.EIO, 'File hash does not match client cached value: ' + args['hashBefore'] + ' vs ' + original_hash)

    # Apply diff; comes in as a flat array containing pairs; action, action data.
    updated_data = bytearray()
    read_cursor = 0
    diff = args['diff']

    for i in range(0, len(diff), 2):
        action = diff[i]
        action_data = diff[i + 1]

        if action == DiffAction.INSERTED:
            updated_data.extend(bytearray(action_data, 'latin-1')) # Action data contains new data inserted
        elif action == DiffAction.REMOVED:
            read_cursor += action_data # Action data contains number of bytes to remove
        else:
            # Action data contains number of bytes to copy from original
            updated_data.extend(original_data[read_cursor:read_cursor+action_data])
            read_cursor += action_data

    updated_hash = hashlib.md5(updated_data).hexdigest()
    if updated_hash != args['hashAfter']:
        raise CodedError(Error.EINVAL, 'File hash after changes applied does not match expected')

    with open(path, 'wb') as fh:
        fh.write(updated_data)

    send_response_header({})

def handle_file_write(args):
    path = os.path.expanduser(args['path'])

    alreadyExists = os.path.exists(path)
    if alreadyExists and not args['overwrite']:
        raise OSError(Error.EEXIST, 'File already exists')
    elif not alreadyExists and not args['create']:
        raise OSError(Error.ENOENT, 'File not found')

    fh = open(path, 'wb')
    fh.write(args['data'])
    fh.close()

    send_response_header({})

def handle_mkdir(args):
    path = os.path.expanduser(args['path'])
    os.mkdir(path)
    send_response_header({})

def handle_delete(args):
    path = os.path.expanduser(args['path'])
    if os.path.isdir(path) and not os.path.islink(path):
        shutil.rmtree(path)
    else:
        os.remove(path)
    send_response_header({})

def handle_rename(args):
    fromPath = os.path.expanduser(args['from'])
    toPath = os.path.expanduser(args['to'])

    if os.path.exists(toPath):
        if args['overwrite']:
            os.unlink(toPath)
        else:
            raise OSError(Error.EEXIST, 'File already exists')

    os.rename(fromPath, toPath)
    send_response_header({})

message_handlers = {
    Opcode.LS:              handle_ls,
    Opcode.GET_SERVER_INFO: handle_get_server_info,
    Opcode.FILE_READ:       handle_file_read,
    Opcode.FILE_WRITE:      handle_file_write,
    Opcode.MKDIR:           handle_mkdir,
    Opcode.DELETE:          handle_delete,
    Opcode.RENAME:          handle_rename,
    Opcode.EXPAND_PATH:     handle_expand_path,
    Opcode.FILE_WRITE_DIFF: handle_file_write_diff,
}
