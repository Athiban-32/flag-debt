import utils.transport
import utils.session
from flagsmith import Flagsmith

flagsmith = Flagsmith(environment_key="server-side-key")


def send_welcome_email(user_id: str) -> None:
    flags = flagsmith.get_identity_flags(user_id)
    if flags.is_feature_enabled("onboarding_tour"):
        queue("onboarding_tour_email", user_id)
    if flags.is_feature_enabled("rate_limit_v2"):
        queue("rate_limited_digest", user_id)


def search_index_job() -> None:
    flags = flagsmith.get_environment_flags()
    if flags.is_feature_enabled("legacy_search"):
        rebuild_v1_index()


def queue(name: str, user_id: str) -> None: ...
def rebuild_v1_index() -> None: ...
