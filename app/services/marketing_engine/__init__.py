"""
Marketing Event Engine — provider-agnostic marketing event pipeline.

Entry point: app.services.marketing_engine.engine.emit_business_event().

Nothing outside this package should import a provider adapter directly or
write to marketing_events/marketing_event_attempts by hand — always go
through engine.emit_business_event() (writing) and
event_store.MarketingEventStore (reading/admin operations).

NOT YET WIRED into order_service.py / orders.py / checkout-form.tsx — see
the TODO list delivered alongside this package. The legacy Meta CAPI flow
(app.services.meta_capi) keeps running unchanged until shadow-mode parity
is validated store by store.
"""
