def price_gate_passed(
    current_price: float,
    previous_price: float,
    threshold_percent: float,
) -> bool:
    """
    Check whether the price movement is large enough
    to trigger further agent decision-making.
    """

    if previous_price <= 0:
        raise ValueError("Previous price must be greater than zero")

    movement_percent = (
        abs(current_price - previous_price)
        / previous_price
        * 100
    )

    return movement_percent >= threshold_percent