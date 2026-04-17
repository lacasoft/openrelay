"""OpenRelay SDK errors."""


class OpenRelayError(Exception):
    """Raised when the OpenRelay API returns an error."""

    def __init__(self, code: str, message: str, param: str | None, doc_url: str):
        super().__init__(message)
        self.code = code
        self.param = param
        self.doc_url = doc_url
