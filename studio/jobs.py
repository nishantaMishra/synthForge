"""Shared validation for local image and text job identifiers."""
from uuid import UUID

from aiohttp import web


def job_id(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise web.HTTPBadRequest(text='Invalid job ID.')
