from typing import Any, Optional
from pydantic import BaseModel
from datetime import date

class FunnelRate(BaseModel):
    assignRate: float
    callRate: float
    confirmRate: float
    deliverRate: float
    returnRate: float

class KpiData(BaseModel):
    totalRevenue: int
    orderRevenue: int = 0
    posRevenue: int = 0
    netRevenue: int
    totalProfit: int = 0
    revenueChange: float
    ordersToday: int
    ordersChange: float
    conversionRate: float
    returnRate: float
    avgOrderValue: int
    totalOrders: int
    confirmedOrders: int
    totalProducts: int
    totalEmployees: int
    pendingOrders: int
    deliveredOrders: int
    returnedOrders: int
    funnelRate: FunnelRate
    buyersCount: int
    acquisitionRate: float
    retentionRate: float
    profitPerOrder: int
    avgCustomerValue: int
    profitPerCustomer: int
    shippingFeeGap: int
    shippingFeeGapPerDelivered: int
    confirmationPerformance: float
    deliveryPerformance: float
    roas: float
    roi: float = 0.0
    cac: int
    ltv: int
    totalDiscounts: Optional[int] = 0
    upsellRevenue: Optional[int] = 0
    abandonedCartRevenue: Optional[int] = 0

class RevenueDataPoint(BaseModel):
    date: str
    revenue: int
    orders: int
    orderRevenue: int = 0
    posRevenue: int = 0
    orderCount: int = 0
    posCount: int = 0

class TopItem(BaseModel):
    id: str
    name: str
    value: float
    secondaryValue: Optional[float] = None
    count: Optional[int] = None

class AnalyticsResponse(BaseModel):
    success: bool
    data: Optional[Any] = None

    model_config = {"arbitrary_types_allowed": True}
