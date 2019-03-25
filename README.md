# Pony SSH

Pony SSH is a VSCode plugin which offers extremely fast file editing via SSH.

**This is an early prototype. Try at your own risk**

## Features

It's very rough at this point, but so far it can:
- Open a remote folder and browse its contents
- Open and edit remote files
- Explode unexpectedly as this is unfinished software.

More features are planned for the near future, including:
- Intelligent file caching
- Remote filesystem watching
- Faster file saving
- GUI to browse and open files

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
