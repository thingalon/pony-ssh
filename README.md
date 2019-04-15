# Pony SSH

Pony SSH is a Visual Studio Code plugin which offers extremely fast file editing via SSH.

## Features

Pony SSH makes editing files over SSH fast and painless. It features:
- Open remote folders and files via SSH, and edit them as though they were local.
- Blazingly fast file browsing, opening and saving.
- Automatically watch the remote file system for changes, and update your local editor instantly.
- Encrypted local caching for extremely fast and secure file access.

## Requirements

Pony SSH requires an SSH server with Python >= 2.7 installed. Almost all Linux/Unix/OSX systems meet the requirements.

## Setup

After installing the extension, add a new `ponyssh.hosts` section to your `settings.json` file, describing each remote system you would like to connect to. 

For example:
```
  "ponyssh.hosts": { 
    "my-host": {
       "host": "my-host.example.com",
       "username": "my-login",
       "password": "123456"
    },
    "another-host": {
       "host": "another-host.example.com",
       "username": "my-login",
       "agent": true
    }
  }
```

Each host can be configured with the following options: 
- `host` **Required** - Hostname or IP address for connection.
- `username` **Required** - Username to use for authentication.
- `port` - Remote port to connect to. Default: 22
- `path` - Default path to open when connecting to this host. Default: `~` (your home directory).
- `password` - Enter your password, or enter `true` (without quotes) to prompt each time you connect.
- `agent` - Specify SSH agent to use for connection, or enter `true` (without quotes) to use a sensible default. (see below)
- `privateKey` - Your private key for authentication
- `privateKeyFile` - Specify a file to load your private key from. eg: `~/.ssh/id_rsa`. Your private key file must be in PEM format.
- `passphrase` - Enter a passphrase for decrypting your private key, if necessary. If you use an encrypted private key but do not specify a passphrase, you will be prompted to enter one each time you connect. 
- `python` - Specify the full path to your python installation on your remote host. By default, pony-ssh uses whichever python installation is in your `PATH`.

### About SSH Agents

In most cases, you can set the `agent` field to `true`, and let Pony SSH pick a sensible default value for you. On Windows, Pony SSH will auto-select Pageant, and on Linux/Unix/OSX systems it will select `$SSH_AUTH_SOCK`.

You can manually configure Pony SSH to use Pageant on Windows by setting your `agent` to `pageant`. Alternately, you can specify the path to your SSH auth socket, or the environment variable in which your SSH auth socket can be found. eg: `/foo/bar/my-socket`, or `$SSH_AUTH_SOCK`.

### Example setups

Authentication using an SSH agent (the easiest secure option), opening `/var/www` by default:
```
 "ponyssh.hosts": { 
    "example-agent-auth": {
       "host": "example.com",
       "username": "my-login",
       "agent": true,
       "path": "/var/www"
    }
  }
```

Ask for a password each time you connect:
```
 "ponyssh.hosts": { 
    "example-password-ask": {
       "host": "example.com",
       "username": "my-login",
       "password": true
    }
  }
```

Load a private key from a file:
```
 "ponyssh.hosts": { 
    "example-password-auth": {
       "host": "example.com",
       "username": "my-login",
       "privateKeyFile": "~/.ssh/my_key"
    }
  }
```

## Usage

To open a remote folder:

- Open the Command Palette (`⌘` + `shift` + `P` on OSX, or `Ctrl` + `shift` + `P` on Windows)
- Search for and run the command "`Pony SSH: Open Remote Folder`"
- Select the remote host you would like to use (based on your configured list in `settings.json`)
- Enter the remote path you would like to enter, or leave it blank to open the default folder. 

## Known Issues

This is a fairly new project, so there may be plenty of issues. 
