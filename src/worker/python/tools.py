import re
import stat
from definitions import FileType

def process_stat(osStat):
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

def vscode_glob_piece_to_regexp(glob_piece):
    atomic_tokens = re.finditer(r'\/(\*\*)|(\*\*)\/|(\*)|(\?)|(\[(?:\\?.)*?\])', glob_piece)
    cursor = 0
    regex = ''
    for token in atomic_tokens:
        if token.start() > cursor:
            regex += re.escape(glob_piece[cursor:token.start()])
        cursor = token.end()

        token_type = token.group()
        if token_type == '*':
            regex += '[^/]+'
        elif token_type == '/**' or token_type == '**/':
            regex += '.*'
        elif token_type == '?':
            regex += '.'
        else:
            regex += token_type
    
    if cursor < len(glob_piece):
        regex += re.escape(glob_piece[cursor:])

    return regex

# Based on https://code.visualstudio.com/docs/editor/codebasics#_advanced-search-options
def vscode_glob_to_regexp(glob):
    group_tokens = re.finditer(r'(\{[^\}]*\})', glob)
    cursor = 0
    regex = '^'
    for group in group_tokens:
        if group.start() > cursor:
            regex += vscode_glob_piece_to_regexp(glob[cursor:group.start()])
        cursor = group.end()

        glob_options = group.group()[1:-1].split(',')
        regex_options = map(lambda opt: '(?:' + vscode_glob_piece_to_regexp(opt) + ')', glob_options)
        regex += '(?:' + '|'.join(regex_options) + ')'

    if cursor < len(glob):
        regex += vscode_glob_piece_to_regexp(glob[cursor:])

    return re.compile(regex + '$')