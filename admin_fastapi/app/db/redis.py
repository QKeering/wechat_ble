from functools import lru_cache

from redis import Redis

from app.core.config import settings


@lru_cache
def redis_client() -> Redis | None:
    if not settings.redis_url:
        return None
    return Redis.from_url(settings.redis_url, decode_responses=False)


def get_redis() -> Redis | None:
    return redis_client()

