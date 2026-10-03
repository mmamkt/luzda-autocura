FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY dev.py ./
COPY backend ./backend
COPY public ./public
COPY content ./content
ENV PORT=8080 DB_PATH=/data/app.db
VOLUME ["/data"]
EXPOSE 8080
CMD ["python", "dev.py"]
