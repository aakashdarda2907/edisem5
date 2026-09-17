from django.urls import path
from . import views

app_name = "queryapp"

urlpatterns = [
    path("", views.index, name="index"),
    path("generate-query/", views.generate_query, name="generate_query"),
    path("revise-query/", views.revise_query, name="revise_query"),
    path("run-query/", views.run_query, name="run_query"),
    path("api-usage/", views.api_usage, name="api_usage"),
]

def api_usage(request):
    today = datetime.now(PACIFIC_TZ).date()

    usage = APIUsage.objects.filter(date=today).first()

    count = usage.count if usage else 0

    return JsonResponse({
        "count": count,
    })