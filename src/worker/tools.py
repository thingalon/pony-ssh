import stat
from definitions import FileType

def processStat(osStat):
    mode = osStat[stat.ST_MODE]
    
    fileType = 0
    if stat.S_ISREG(mode):
        fileType = FileType.FILE
    elif stat.S_ISDIR(mode):
        fileType = FileType.DIRECTORY
    if stat.S_ISLNK(mode):
        fileType += FileType.SYMLINK

    return [
        fileType,
        osStat[stat.ST_MTIME],
        osStat[stat.ST_CTIME],
        osStat[stat.ST_SIZE]
    ]
