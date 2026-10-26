FROM node:24-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY backend/BorrowApp.Api/BorrowApp.Api.csproj backend/BorrowApp.Api/
RUN dotnet restore backend/BorrowApp.Api
COPY backend/ backend/
RUN dotnet publish backend/BorrowApp.Api -c Release -o /app/publish --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=backend /app/publish .
COPY --from=frontend /app/frontend/dist ./wwwroot
RUN mkdir -p /app/data && chown -R app:app /app/data
ENV ASPNETCORE_HTTP_PORTS=8080
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "BorrowApp.Api.dll"]
