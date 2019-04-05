# Pony SSH

Pony SSH is a VSCode plugin which offers extremely fast file editing via SSH.

**This is an early prototype. Try at your own risk**

## Features

So far, Pony-SSH can:
- Open remote folders, and add them to your workspace
- Open and edit remote files
- Save remote files extremely quickly
- Cache remote file content w/ encryption, for fast file access without sacrificing security
- Watch for changes on the remote filesystem automatically
- Explode unexpectedly because it is not quite finished yet. :) 

Also planned, but not implemented yet:
- A nice GUI for setting up server connections and browsing remote filesystems to open files / folders

## Setup

Add a `ponyssh.hosts` block to your `settings.json` file with a set of named objects describing each host you would like to use. 

For example:
```
 "ponyssh.hosts": { 
        "example": {
            "host": "example.com",
            "username": "mylogin",
            "path": "/srv/www"
        },
        "something-else": {
            "host": "another-host.example.com",
            "username": "nobody",
            "password": "abc123"
        }
    }
```

The following host configuration options are accepted: 
- `host` - IP address or hostname to connect to
- `port` - Port number; defaults to 22
- `username` - Username for authentication
- `password` - Password for authentication
- `agent` - Specify agent or UNIX socket to use. Generally `"pageant"` on Windows, or `$SSH_AUTH_SOCK` on POSIX systems.
- `path` - The default path to use when opening a folder on this host.

If you don't specify a `password` or `agent` in your host configuration, Pony SSH will automatically try to use a sensible platform-specific default. (eg: `pageant` or `$SSH_AUTH_SOCK`).

## Usage

To open a remote folder: 
- Open the VSCode command palette (`ctrl`+`shift`+`P` on Windows, or `cmd`+`shift`+`P` on OSX)
- Run the command "`Pony SSH: Open Remote Folder`"
- Select the remote host you would like to use (from your configured list in `settings.json`)
- Enter the remote path you would like to open (or leave blank to open your remote home directory).

## Known Issues

Lots. This is not finished / ready for production.
