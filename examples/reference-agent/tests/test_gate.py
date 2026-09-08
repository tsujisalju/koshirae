from app.services.gate import price_gate_passed


def test_gate_fails_when_price_move_is_below_threshold():
    assert price_gate_passed(
        current_price=102,
        previous_price=100,
        threshold_percent=5,
    ) is False


def test_gate_passes_when_price_move_reaches_threshold():
    assert price_gate_passed(
        current_price=105,
        previous_price=100,
        threshold_percent=5,
    ) is True


def test_gate_passes_when_price_drops():
    assert price_gate_passed(
        current_price=90,
        previous_price=100,
        threshold_percent=5,
    ) is True