# Despliegue de la demo (Coolify + VPS, detrás de proxy con TLS)

La demo es un contenedor único (Node 20 + SQLite embebida). La base de datos y
los adjuntos viven en `/data`, que **debe ser un volumen persistente**. No se
publica el puerto directamente: el proxy inverso de Coolify (Traefik) termina el
TLS y enruta al contenedor.

## Variables de entorno

| Variable | Valor por defecto (en la imagen) | Para qué |
|---|---|---|
| `PORT` | `4000` | Puerto de escucha del contenedor. |
| `DB_PATH` | `/data/taller.db` | Fichero SQLite. **Debe apuntar al volumen.** |
| `UPLOADS_DIR` | `/data/uploads` | Adjuntos SVG generados. **En el volumen.** |
| `PUBLIC_BASE_URL` | — | URL pública, para componer enlaces. Ej: `https://demo.tu-dominio`. |
| `TIMEZONE` | `Europe/Madrid` | Zona horaria de referencia. |
| `WEBHOOKS_ENABLED` | `0` | Déjalo en `0`. Con `1` se montan los webhooks públicos (no recomendado en demo). |

`NODE_ENV=production` ya viene fijado en la imagen.

## Qué hace el contenedor al arrancar

1. Comprueba si la base tiene pedidos.
2. Si está **vacía** (primer arranque), ejecuta `npm run seed` y crea 3 clientes,
   6 usuarios y ~72 pedidos ficticios deterministas.
3. Si **ya tiene datos** (reinicio con el volumen), no re-siembra: conserva el
   estado.
4. Arranca el servidor (panel + API) en `PORT`.

## Pasos en Coolify

Estos pasos dependen de tu VPS y tu cuenta de Coolify. Hazlos tú:

1. **DNS.** Crea un registro `A` (o `AAAA`) del subdominio de la demo
   (p. ej. `demo.tu-dominio`) apuntando a la IP del VPS. Espera propagación.
2. **Nuevo recurso en Coolify** → *Application* → origen **Git** (el repositorio
   de esta demo) o **Dockerfile** si subes la imagen. Rama `main`.
3. **Build Pack: Dockerfile.** Coolify detecta el `Dockerfile` en la raíz.
4. **Puerto interno: `4000`.** No mapees puertos al host; deja que el proxy de
   Coolify enrute. Asigna el **dominio** `https://demo.tu-dominio` y activa
   **HTTPS/Let's Encrypt** (Coolify gestiona el certificado con Traefik).
5. **Volumen persistente.** Añade un *Persistent Storage* montado en **`/data`**.
   Sin esto, los datos se pierden en cada redepliegue.
6. **Variables de entorno.** Añade `PUBLIC_BASE_URL=https://demo.tu-dominio`.
   El resto ya trae valores por defecto correctos en la imagen.
7. **Deploy.** Coolify construye la imagen y levanta el contenedor. El primer
   arranque siembra la demo automáticamente.
8. **Verifica.** Abre `https://demo.tu-dominio` (panel) y
   `https://demo.tu-dominio/api/health` (debe responder `{ "ok": true }`).

## Reset de los datos (opcional, desde el VPS)

No hay endpoint de reinicio por HTTP a propósito. Si quieres regenerar la demo:

- Borra el fichero de base de datos del volumen (`/data/taller.db*`) y los
  adjuntos (`/data/uploads/*`) y reinicia el contenedor: al ver la base vacía,
  volverá a sembrar.
- O ejecuta dentro del contenedor: `npm run seed` (regenera de forma
  determinista; borra y recrea los datos `is_demo`).

## Prueba local con Docker (antes de subir al VPS)

```bash
docker build -t taller-demo .
docker run --rm -p 4000:4000 -v taller_data:/data taller-demo
# abrir http://localhost:4000
```

(En el VPS **no** uses `-p` para publicar el puerto: lo hace el proxy.)
