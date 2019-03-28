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

class FileType:
    FILE      = 0x01
    DIRECTORY = 0x02
    SYMLINK   = 0x10
