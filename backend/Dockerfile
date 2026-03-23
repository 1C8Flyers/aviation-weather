FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --only=production

COPY . .

ENV PORT=4000
EXPOSE 4000

CMD ["npm", "start"]
