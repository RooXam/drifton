"""Styles: friendly groups built from the dataset's Spotify genre tags.

Each song carries tags like 'conscious hip hop' 'neo soul' 'lo-fi beats'. A style is a list
of words to look for in those tags; a song can belong to several styles.
`exclude` removes tags that contain a word but mean something else ('rap metal').
"""

STYLES = [
    # id, label, words looked for in the tags, tags to leave out
    ("hiphop", "Hip-hop", ["hip hop", "rap", "trap", "boom bap"], ["rap metal", "rap rock", "country rap", "trap latino"]),
    ("rnb", "R&B · neo soul", ["r&b", "neo soul", "bedroom soul", "indie soul"], []),
    ("soul", "Soul · gospel", ["classic soul", "southern soul", "motown", "gospel", "funk"], ["bluegrass gospel", "country gospel", "southern gospel", "funk metal", "funk rock"]),
    ("jazz", "Jazz · bossa", ["jazz", "bossa nova"], []),
    ("lofi", "Lo-fi · bedroom", ["lo-fi", "bedroom pop", "chillhop"], []),
    ("dream", "Dream pop · shoegaze", ["dream pop", "shoegaze", "slowcore", "ethereal"], []),
    ("cinematic", "Cinematic · anime · games", ["soundtrack", "anime", "video game", "score"], []),
    ("asian", "K-pop · J-pop · city pop", ["k-pop", "j-pop", "city pop", "j-rock", "j-poprock"], ["folk-pop"]),
    ("electronic", "Electronic · house · disco", ["house", "disco", "edm", "electro", "synthwave"], []),
    ("latin", "Latin · reggaeton", ["latin", "reggaeton", "urbano", "salsa", "bachata"], ["latin worship", "latin christian"]),
    ("emo", "Emo · punk", ["emo", "punk", "screamo"], ["emo rap"]),
    ("metal", "Metal", ["metal"], []),
    ("blues", "Blues", ["blues"], []),
    ("indie", "Indie · folk", ["indie folk", "indie rock", "indie pop", "chamber pop", "folk"], []),
    ("rock", "Rock", ["rock"], ["indie rock"]),
    ("country", "Country", ["country", "bluegrass", "americana"], []),
    ("worship", "Worship · CCM", ["worship", "ccm", "christian"], []),
    ("pop", "Pop", ["pop"], ["k-pop", "j-pop", "indie pop", "dream pop", "bedroom pop", "chamber pop"]),
]


def styles_of(tags):
    """tags: the song's Spotify genre tags. Returns the set of style ids."""
    found = set()
    for sid, _label, words, exclude in STYLES:
        for tag in tags:
            if tag in exclude:
                continue
            if any(w in tag for w in words):
                found.add(sid)
                break
    return found
