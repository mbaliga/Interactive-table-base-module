API keys for the hub's data proxies (one file per source, never committed, never sent to a browser).

  config/keys/<source>.txt     the key on its own line; lines starting with # are ignored
  or the environment variable  HUB_KEY_<SOURCE>   (dashes become underscores, e.g. weather-api -> HUB_KEY_WEATHER_API)

<source> is the name under "proxies" in hub.config.json. The pages then call /proxy/<source>/<endpoint> on the hub,
and the hub adds the key server-side. The installers restrict these files to the service account.
