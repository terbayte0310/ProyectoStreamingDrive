# 03 · Vacíos funcionales

Un vacío es una capacidad ausente, no necesariamente un defecto.

| ID | Vacío | Consecuencia | Próximo paso |
| --- | --- | --- | --- |
| VAC-01 | Progreso persistente de películas/episodios | Sin continuidad entre dispositivos | Modelo por usuario/contenido, RLS y eventos |
| VAC-02 | Cola automática de episodios | Página recibe paquete, no cola de temporada | Resolver siguiente publicado/autorizado; cuenta atrás cancelable |
| VAC-03 | Miniaturas de la barra | Seek sin fotograma de previsualización | Sprites/VTT en preparación HLS |
| VAC-04 | Intervalos de introducción/créditos | No se puede ofrecer salto correcto | Modelo de intervalos validado |
| VAC-05 | Lista personal y vistos | Sin guardar títulos para después | Persistencia por usuario |
| VAC-06 | Búsqueda a escala | Filtros solo sobre conjunto cargado | Búsqueda en servidor, paginación y URL |
| VAC-07 | Curaduría del destacado | Cursos prioriza continuidad/primer curso | Campo editorial con fallback |
| VAC-08 | Televisor y mando | Responsive no garantiza foco espacial | Pruebas específicas |
| VAC-09 | Diagnóstico de reproducción | Sin métricas de primer frame/errores/buffering | Eventos sin credenciales |
| VAC-10 | Offline, casting, DRM | No incluidos por personalizar controles | Definir requisitos y transporte |

Audio, subtítulos y calidad aparecen según el manifiesto. No se simula disponibilidad. Los controles nativos siguen disponibles para funciones del navegador.

Los módulos permanecen sujetos a acceso real. La galería de desarrollo no demuestra disponibilidad ni calidad del catálogo privado.
