from core.utils.textUtils import EMOJI_MAP, check_emoji, extract_emotion


def test_extract_emotion_common_llm_emojis():
    assert extract_emotion("😢 好吧，给你一个委屈巴巴的表情") == ("😢", "sad")
    assert extract_emotion("  🥺 别难过啦") == ("🥺", "sad")
    assert extract_emotion("😊 好呀，想听点什么呢？") == ("😊", "happy")
    assert extract_emotion("😡 真是气死我了") == ("😡", "angry")
    assert extract_emotion("🤩 太棒了！") == ("🤩", "excited")
    assert extract_emotion("🧐 让我看看") == ("🧐", "curious")
    assert extract_emotion("😕 没听太懂") == ("😕", "confused")
    assert extract_emotion("☹️ 委屈") == ("☹", "sad")
    assert extract_emotion("普通文本没有表情") is None


def test_check_emoji_strips_emojis_and_variation_selectors():
    assert check_emoji("😢 好吧").strip() == "好吧"
    assert check_emoji("☹️ 委屈").strip() == "委屈"


def test_all_emoji_map_keys_are_single_codepoints():
    for key in EMOJI_MAP:
        assert len(key) == 1, f"Multi-codepoint key in EMOJI_MAP cannot match char loop: {key!r}"
