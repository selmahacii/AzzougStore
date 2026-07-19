"""
Provider plugins. Each subpackage (meta/, tiktok/, ga4/, ...) must expose
an `adapter.py` module with a module-level `PROVIDER` instance implementing
`app.services.marketing_engine.providers.base.MarketingProvider`.

dispatcher.discover_providers() walks this package at runtime — adding a
new provider means adding a new subpackage here and a provider_event_mappings
row, nothing in dispatcher.py or engine.py ever changes.
"""
