FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 DATA_DIR=/data PORT=3100
RUN useradd --uid 10001 --create-home workshop && mkdir /data && chown workshop:workshop /data
COPY --chown=workshop:workshop server.py ./
COPY --chown=workshop:workshop static ./static
USER workshop
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3100/health', timeout=3)"
CMD ["python", "server.py"]
