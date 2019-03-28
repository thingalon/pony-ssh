import sys
import msgpack
from definitions import ParcelType

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
    
def prepareMessageReader():
    return msgpack.Unpacker(MessageReader(), raw=False)


def sendError(code, message):
    sendParcel(ParcelType.ERROR, msgpack.packb({ 'code': code, 'error': message }))

def sendResponseHeader(response):
    sendParcel(ParcelType.HEADER, msgpack.packb(response))

def sendParcel(type, data):
    sys.stdout.write(chr(type) + msgpack.packb(len(data)) + data)

def sendEmptyParcel():
    sys.stdout.write(msgpack.packb(0))
