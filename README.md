# n8n

n8n is a flexible AI workflow automation for technical teams.
It allows you to build flexible workflows focused on deep data integration.

## Install

Instantiate the module with:

    add-module ghcr.io/nethserver/n8n:latest 1

The output of the command will return the instance name.
Output example:

    {"module_id": "n8n", "image_name": "n8n", "image_url": "ghcr.io/nethserver/n8n:latest"}

## Configure

Let's assume that the n8n instance is named `n8n1`.

Launch `configure-module`, by setting the following parameters:


- `lets_encrypt`: Set Letsecnrypt to True or False, Default is False
- `http2https`: set redirect to True or False, Default is True
- `host`: the traefik host url for the project
- `timezone`: Set timezone, default is UTC

Example:

    api-cli run module/n8n1/configure-module --data '{"host": "n8n.domain.com"}'

    or if modifying another value: 

    api-cli run module/n8n5/configure-module --data '{"host": "n8n.domain.com","n8n_name": "Myn8n"}'

    api-cli run module/n8n1/configure-module --data '{
        "host": "n8n.host.org",
        "lets_encrypt": false,
        "http2https": true,
    }'


The above command will:
- start and configure the n8n instance
- Optionally enable https redirect
- Configure letsencrypt certificate
- Set the timezone for the app

After configuration n8n can be accessed under the set host/FQDN to configure an admin user.

## Smarthost setting discovery

Some configuration settings, like the smarthost setup, are not part of the
`configure-module` action input: they are discovered by looking at some
Redis keys.  To ensure the module is always up-to-date with the
centralized [smarthost
setup](https://nethserver.github.io/ns8-core/core/smarthost/) every time
kickstart starts, the command `bin/discover-smarthost` runs and refreshes
the `state/smarthost.env` file with fresh values from Redis.

Furthermore if smarthost setup is changed when ns8-n8n is already
running, the event handler `events/smarthost-changed/10reload_services`
restarts the main module service.

See also the `systemd/user/n8n-server.service` file.

This setting discovery is just an example to understand how the module is
expected to work: it can be rewritten or discarded completely.

## Uninstall

To uninstall the instance:

    remove-module --no-preserve n8n1

## Testing

Test the module using the `test-module.sh` script:

    ./test-module.sh <NODE_ADDR> ghcr.io/nethserver/n8n:latest

The tests are made using [Robot Framework](https://robotframework.org/)

## UI translation

Translated with [Weblate](https://hosted.weblate.org/projects/ns8/).

To setup the translation process:

- add [GitHub Weblate app](https://docs.weblate.org/en/latest/admin/continuous.html#github-setup) to your repository
- add your repository to [hosted.weblate.org]((https://hosted.weblate.org) or ask a NethServer developer to add it to ns8 Weblate project
