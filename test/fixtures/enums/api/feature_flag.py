from enum import Enum


class Feature(Enum):
    NEW_SEARCH = 'new_search'
    EXPORT_CSV = 'export_csv'  # defined, never read in Python


def is_feature_enabled(feature):
    return True


def handler():
    if is_feature_enabled(Feature.NEW_SEARCH):
        return 'new'
