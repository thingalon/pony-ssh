import sys
import msgpack
import logging
import binascii
from definitions import ParcelType
import sys

is_python_3 = (sys.version_info >= (3, 0))
if is_python_3:
    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
else:
    stdin = sys.stdin
    stdout = sys.stdout

class MessageReader:
    def __init__(self):
        self.message_size = 0

    def read_message_size(self):
        pack_header = stdin.read(1)
        if len(pack_header) == 0:
            return 0

        read_size = { 0xcc: 1, 0xcd: 2, 0xce: 4, 0xcf: 8 }.get(ord(pack_header), 0)
        if read_size > 0:
            pack_header += stdin.read(read_size)
        self.message_size = msgpack.unpackb(pack_header, raw=True)

    def read(self, bytes):
        if self.message_size <= 0:
            self.read_message_size()

        read_bytes = stdin.read(min(16384, self.message_size))
        self.message_size -= len(read_bytes)
        return read_bytes

def prepare_message_reader():
    return msgpack.Unpacker(MessageReader(), raw=False)

def send_error(code, message):
    send_parcel(ParcelType.ERROR, msgpack.packb({ 'code': code, 'error': message }))

def send_response_header(response):
    send_parcel(ParcelType.HEADER, msgpack.packb(response))

def send_parcel(parcel_type, data):
    stdout.write(bytearray([parcel_type]))
    stdout.write(msgpack.packb(len(data)))
    stdout.write(data)
    stdout.flush()

def send_empty_parcel():
    sys.stdout.write(msgpack.packb(0))

def send_warning(message):
    send_parcel(ParcelType.WARNING, message)

def send_change_notice(paths):
    send_parcel(ParcelType.CHANGE_NOTICE, msgpack.packb(paths))
