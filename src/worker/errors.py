import errno

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

class CodedError(Exception):
    def __init__(self, code, message):
        super(CodedError, self).__init__(message)
        self.code = code
        self.message = message

def process_error(osError):
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
