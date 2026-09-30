# Build context: repository root.
#   docker build -f apps/anonymizer/Dockerfile -t anonymizer .
#   docker build -f apps/anonymizer/Dockerfile --build-arg WITH_NER=1 -t anonymizer:ner .
FROM python:3.12-slim

ARG WITH_NER=0
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ANONYMIZER_HOST=0.0.0.0 \
    ANONYMIZER_PORT=8090

RUN if [ "$WITH_NER" = "1" ]; then \
      pip install --no-cache-dir "spacy>=3.8" \
      && python -m spacy download pl_core_news_sm \
      && python -m spacy download en_core_web_sm; \
    fi

WORKDIR /app
COPY apps/anonymizer /app
RUN useradd --system --no-create-home anonymizer
USER anonymizer

EXPOSE 8090
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"ANONYMIZER_PORT\"]}/health', timeout=2)"
CMD ["python", "-m", "anonymizer.server"]
