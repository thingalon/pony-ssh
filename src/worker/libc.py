import ctypes
import ctypes.util
import struct

class Libc:
    IN_MODIFY      = 0x00000002 # File changed
    IN_ATTRIB      = 0x00000004 # Metadata changed
    IN_CLOSE_WRITE = 0x00000008 # Writeable file closed
    IN_MOVED_FROM  = 0x00000040 # Moved *from*
    IN_MOVED_TO    = 0x00000080 # Moved *to*
    IN_CREATE      = 0x00000100 # File created
    IN_DELETE      = 0x00000200 # File deleted
    IN_DELETE_SELF = 0x00000400 # Watched directory deleted
    IN_MOVE_SELF   = 0x00000800 # Watched directory moved

    IN_ALL_CHANGES = (IN_MODIFY | IN_ATTRIB | IN_CLOSE_WRITE | IN_MOVED_FROM | 
        IN_MOVED_TO | IN_CREATE | IN_DELETE | IN_DELETE_SELF | IN_MOVE_SELF)

    IN_CREATED_CHANGES = (IN_MOVED_TO | IN_CREATE)
    IN_DELETED_CHANGES = (IN_MOVED_FROM | IN_DELETE | IN_DELETE_SELF | IN_MOVE_SELF)

    INOTIFY_HEADER_FORMAT = 'iIII'
    INOTIFY_HEADER_SIZE = struct.calcsize(INOTIFY_HEADER_FORMAT)

    def __init__(self):
        libc_path = ctypes.util.find_library('c')
        if libc_path is None:
            libc_path = 'libc.so.6'

        lib = ctypes.cdll.LoadLibrary(libc_path)
        if lib is None:
            raise ImportError('Failed to load libc for inotify functionality')

        self.inotify_init = lib.inotify_init
        self.inotify_init.argtypes = []

        self.inotify_add_watch = lib.inotify_add_watch
        self.inotify_add_watch.argtypes = [ ctypes.c_int, ctypes.c_char_p, ctypes.c_uint32 ]

        self.inotify_rm_watch = lib.inotify_rm_watch
        self.inotify_rm_watch.argtypes = [ctypes.c_int, ctypes.c_int]

loaded_libc = None
def get_libc():
    global loaded_libc
    if loaded_libc == None:
        loaded_libc = Libc()
    return loaded_libc
