import logging
import os
import sys
import traceback

from errors import Error, CodedError, processError
from protocol import prepareMessageReader, sendError
from handlers import messageHandlers

logging.basicConfig(filename=os.path.expanduser('~/.pony-ssh/debug.log'), level=logging.DEBUG)

def runWorker():
    messageUnpacker = prepareMessageReader()
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

runWorker()

