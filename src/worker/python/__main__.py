import logging
import os
import sys
import traceback

from errors import Error, CodedError, process_error
from protocol import prepare_message_reader, send_error
from handlers import message_handlers
from libc import get_libc
from watcher import Watcher

import traceback

# Create ~/.pony-ssh dir if it doesn't exist.
pony_ssh_home = os.path.expanduser( '~/.pony-ssh' )
if not os.path.exists( pony_ssh_home ):
    os.makedirs( pony_ssh_home )

logging.basicConfig(filename=os.path.expanduser('~/.pony-ssh/debug.log'), level=logging.DEBUG)

def run_watcher():
    try:
        get_libc()
        watcher = Watcher()
        watcher.run()
    except CodedError as err:
        send_error(err.code, err.message)
    except OSError as err:
        logging.warning(err)
        send_error(process_error(err.errno), err.strerror)
    except BaseException as err:
        logging.warning(err)
        if hasattr(err, '__traceback__'):
            logging.warning(''.join(traceback.format_tb(err.__traceback__)))
        send_error(Error.EINVAL, str(err) + '\n' + traceback.format_exc())

def run_worker():
    messageUnpacker = prepare_message_reader()
    for message in messageUnpacker:
        try:
            [opcode, args] = message
            handler = message_handlers.get(opcode, None)
            if handler != None:
                handler(args)
            else:
                send_error(Error.EINVAL, "Unknown opcode: " + str(opcode))
        except CodedError as err:
            send_error(err.code, err.message)
        except OSError as err:
            logging.warning(err)
            send_error(process_error(err.errno), err.strerror)
        except BaseException as err:
            logging.warning(err)
            send_error(Error.EINVAL, str(err) + '\n' + traceback.format_exc())
        finally:
            sys.stdout.flush()

if len(sys.argv) > 1 and sys.argv[1] == 'watcher':
    run_watcher()
else:
    run_worker()
