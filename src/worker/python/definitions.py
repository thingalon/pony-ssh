class ParcelType:
    # Request responses
    HEADER        = 0x01
    BODY          = 0x02
    ERROR         = 0x03
    ENDOFBODY     = 0x04

    # Push notifications
    WARNING       = 0x05
    CHANGE_NOTICE = 0x06

class Opcode:
    LS              = 0x01
    GET_SERVER_INFO = 0x02
    FILE_READ       = 0x03
    FILE_WRITE      = 0x04
    MKDIR           = 0x05
    DELETE          = 0x06
    RENAME          = 0x07
    EXPAND_PATH     = 0x08
    FILE_WRITE_DIFF = 0x09
    ADD_WATCH       = 0x10
    REMOVE_WATCH    = 0x11

class DiffAction:
    UNCHANGED = 0x00
    INSERTED  = 0x01
    REMOVED   = 0x02

class FileType:
    FILE      = 0x01
    DIRECTORY = 0x02
    SYMLINK   = 0x10

class ChangeType:
    CHANGED = 0x01
    CREATED = 0x02
    DELETED = 0x03
